import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import JSZip from "jszip";
import { StringEnum, Type, complete, getModel, type Model, type Api } from "@mariozechner/buddy-ai";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@mariozechner/buddy-coding-agent";
import { Container, Text, matchesKey } from "@mariozechner/buddy-tui";

interface TodoItem {
	id: number;
	text: string;
	done: boolean;
}

interface TodoToolDetails {
	action: "list" | "add" | "toggle" | "remove" | "clear" | "replace";
	todos: TodoItem[];
	nextId: number;
	error?: string;
}

type Scalar = string | number | boolean | null;
type TableRow = Record<string, Scalar>;
type PlotPoint = { x: number; y: number; label?: string };
type CitationSource = {
	title?: string;
	url?: string;
	author?: string;
	publishedAt?: string;
	site?: string;
};

type DatasetInput = {
	dataJson?: string;
	csv?: string;
	path?: string;
};

const todoItems: TodoItem[] = [];
let nextTodoId = 1;

function unique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function wrapPlainText(text: string, maxLineLength: number): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [""];
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const next = current.length === 0 ? word : `${current} ${word}`;
		if (next.length > maxLineLength && current.length > 0) {
			lines.push(current);
			current = word;
		} else {
			current = next;
		}
	}
	if (current.length > 0) {
		lines.push(current);
	}
	return lines;
}

function parseCsvLine(line: string): string[] {
	const cells: string[] = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			cells.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}
	cells.push(current.trim());
	return cells;
}

function parseCsv(text: string): TableRow[] {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return [];
	const headers = parseCsvLine(lines[0]);
	const rows: TableRow[] = [];
	for (const line of lines.slice(1)) {
		const cells = parseCsvLine(line);
		const row: TableRow = {};
		headers.forEach((header, index) => {
			const raw = cells[index] ?? "";
			const numeric = Number(raw);
			row[header] = raw !== "" && !Number.isNaN(numeric) ? numeric : raw;
		});
		rows.push(row);
	}
	return rows;
}

async function loadDataset(cwd: string, input: DatasetInput): Promise<unknown> {
	if (input.dataJson) {
		return JSON.parse(input.dataJson);
	}
	if (input.csv) {
		return parseCsv(input.csv);
	}
	if (!input.path) {
		throw new Error("Provide dataJson, csv, or path.");
	}
	const absolutePath = resolve(cwd, input.path);
	const content = await readFile(absolutePath, "utf8");
	const extension = extname(absolutePath).toLowerCase();
	if (extension === ".csv") {
		return parseCsv(content);
	}
	if (extension === ".json") {
		return JSON.parse(content);
	}
	try {
		return JSON.parse(content);
	} catch {
		return parseCsv(content);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTableRows(data: unknown): TableRow[] {
	if (!Array.isArray(data)) {
		throw new Error("Expected an array dataset.");
	}
	if (data.length === 0) {
		return [];
	}
	if (typeof data[0] === "number") {
		return (data as number[]).map((value, index) => ({ index: index + 1, value }));
	}
	if (Array.isArray(data[0])) {
		return (data as unknown[][]).map((row, rowIndex) => {
			const result: TableRow = { row: rowIndex + 1 };
			row.forEach((value, index) => {
				result[`col_${index + 1}`] =
					typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
						? value
						: JSON.stringify(value);
			});
			return result;
		});
	}
	if (isRecord(data[0])) {
		return (data as Record<string, unknown>[]).map((row) => {
			const result: TableRow = {};
			for (const [key, value] of Object.entries(row)) {
				result[key] =
					typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
						? value
						: JSON.stringify(value);
			}
			return result;
		});
	}
	throw new Error("Unsupported dataset shape.");
}

function findNumericColumns(rows: TableRow[]): string[] {
	if (rows.length === 0) return [];
	const keys = unique(rows.flatMap((row) => Object.keys(row)));
	return keys.filter((key) => rows.some((row) => typeof row[key] === "number"));
}

function toNumericSeries(data: unknown, column?: string): number[] {
	if (Array.isArray(data) && data.every((value) => typeof value === "number")) {
		return [...(data as number[])];
	}
	const rows = toTableRows(data);
	const numericColumns = findNumericColumns(rows);
	const targetColumn = column ?? numericColumns[0];
	if (!targetColumn) {
		throw new Error("No numeric column found in dataset.");
	}
	return rows
		.map((row) => row[targetColumn])
		.filter((value): value is number => typeof value === "number");
}

function toPlotPoints(data: unknown, xKey?: string, yKey?: string): PlotPoint[] {
	if (Array.isArray(data) && data.every((value) => typeof value === "number")) {
		return (data as number[]).map((y, index) => ({ x: index + 1, y }));
	}
	if (Array.isArray(data) && data.every((value) => Array.isArray(value) && value.length >= 2)) {
		return (data as unknown[][]).map((value) => ({ x: Number(value[0]), y: Number(value[1]) }));
	}
	const rows = toTableRows(data);
	const numericColumns = findNumericColumns(rows);
	const resolvedYKey = yKey ?? numericColumns[numericColumns.length > 1 ? 1 : 0];
	const resolvedXKey = xKey ?? numericColumns[0];
	if (!resolvedYKey) {
		throw new Error("Could not find a numeric y-axis column.");
	}
	return rows
		.map((row, index) => {
			const yValue = row[resolvedYKey];
			if (typeof yValue !== "number") return undefined;
			const xValue = resolvedXKey ? row[resolvedXKey] : index + 1;
			const numericX = typeof xValue === "number" ? xValue : index + 1;
			const label = typeof row.label === "string" ? row.label : undefined;
			return { x: numericX, y: yValue, label };
		})
		.filter((point): point is PlotPoint => point !== undefined);
}

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function standardDeviation(values: number[]): number {
	const avg = mean(values);
	const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

function linearRegressionSlope(points: PlotPoint[]): number {
	const n = points.length;
	const sumX = points.reduce((sum, point) => sum + point.x, 0);
	const sumY = points.reduce((sum, point) => sum + point.y, 0);
	const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
	const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);
	const denominator = n * sumXX - sumX * sumX;
	if (denominator === 0) return 0;
	return (n * sumXY - sumX * sumY) / denominator;
}

function createPlotSvg(chartType: "line" | "bar" | "scatter", points: PlotPoint[], title: string): string {
	const width = 960;
	const height = 540;
	const padding = 64;
	const innerWidth = width - padding * 2;
	const innerHeight = height - padding * 2;
	const minX = Math.min(...points.map((point) => point.x));
	const maxX = Math.max(...points.map((point) => point.x));
	const minY = Math.min(...points.map((point) => point.y));
	const maxY = Math.max(...points.map((point) => point.y));
	const xRange = maxX - minX || 1;
	const yRange = maxY - minY || 1;
	const mapX = (value: number) => padding + ((value - minX) / xRange) * innerWidth;
	const mapY = (value: number) => height - padding - ((value - minY) / yRange) * innerHeight;
	const polyline = points.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(" ");
	const circles = points
		.map(
			(point) =>
				`<circle cx="${mapX(point.x).toFixed(2)}" cy="${mapY(point.y).toFixed(2)}" r="5" fill="#60a5fa" />`,
		)
		.join("\n");
	const bars = points
		.map((point, index) => {
			const barWidth = innerWidth / Math.max(points.length, 1) * 0.65;
			const x = padding + index * (innerWidth / Math.max(points.length, 1)) + barWidth * 0.2;
			const y = mapY(point.y);
			const barHeight = height - padding - y;
			return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="6" fill="#34d399" />`;
		})
		.join("\n");
	const chartMarkup =
		chartType === "bar"
			? bars
			: `${
				chartType === "line"
					? `<polyline fill="none" stroke="#60a5fa" stroke-width="3" points="${polyline}" />`
					: ""
			}\n${circles}`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0f172a" rx="18" />
  <text x="${padding}" y="40" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700" fill="#e2e8f0">${escapeXml(title)}</text>
  <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#475569" stroke-width="2" />
  <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#475569" stroke-width="2" />
  ${chartMarkup}
  <text x="${padding}" y="${height - 24}" font-family="monospace" font-size="12" fill="#94a3b8">x: ${minX} → ${maxX}</text>
  <text x="${width - padding - 160}" y="${padding - 18}" font-family="monospace" font-size="12" fill="#94a3b8">y: ${minY.toFixed(2)} → ${maxY.toFixed(2)}</text>
</svg>`;
}

function formatScalar(value: Scalar): string {
	if (value === null) return "";
	return String(value);
}

function rowsToMarkdown(rows: TableRow[]): string {
	if (rows.length === 0) return "| No data |\n| --- |\n| Empty |";
	const columns = unique(rows.flatMap((row) => Object.keys(row)));
	const header = `| ${columns.join(" | ")} |`;
	const separator = `| ${columns.map(() => "---").join(" | ")} |`;
	const body = rows
		.map((row) => `| ${columns.map((column) => formatScalar(row[column] ?? null)).join(" | ")} |`)
		.join("\n");
	return `${header}\n${separator}\n${body}`;
}

function rowsToHtml(rows: TableRow[]): string {
	if (rows.length === 0) return "<table><thead><tr><th>No data</th></tr></thead><tbody><tr><td>Empty</td></tr></tbody></table>";
	const columns = unique(rows.flatMap((row) => Object.keys(row)));
	const header = columns.map((column) => `<th>${escapeXml(column)}</th>`).join("");
	const body = rows
		.map(
			(row) =>
				`<tr>${columns
					.map((column) => `<td>${escapeXml(formatScalar(row[column] ?? null))}</td>`)
					.join("")}</tr>`,
		)
		.join("\n");
	return `<table>\n<thead><tr>${header}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

function rowsToAsciiTable(rows: TableRow[]): string {
	if (rows.length === 0) return renderAsciiFrame("Table", ["No data"]);
	const columns = unique(rows.flatMap((row) => Object.keys(row)));
	const widths = columns.map((column) => Math.min(24, Math.max(column.length, ...rows.map((row) => formatScalar(row[column] ?? null).length))));
	const separator = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
	const header = `| ${columns.map((column, index) => column.padEnd(widths[index])).join(" | ")} |`;
	const body = rows
		.slice(0, 8)
		.map((row) => `| ${columns.map((column, index) => formatScalar(row[column] ?? null).slice(0, widths[index]).padEnd(widths[index])).join(" | ")} |`)
		.join("\n");
	return [separator, header, separator, body, separator].join("\n");
}

function heuristicRewrite(text: string, tone: string, brevity: string, readingLevel: string): string {
	let rewritten = text.trim();
	if (tone === "executive_summary") {
		const sentences = rewritten.split(/(?<=[.!?])\s+/).slice(0, 3);
		rewritten = sentences.map((sentence) => `- ${sentence.trim()}`).join("\n");
	}
	if (brevity === "shorter") {
		rewritten = rewritten.split(/(?<=[.!?])\s+/).slice(0, 4).join(" ");
	}
	if (readingLevel === "simple") {
		rewritten = rewritten
			.replace(/utilize/gi, "use")
			.replace(/approximately/gi, "about")
			.replace(/demonstrate/gi, "show");
	}
	if (tone === "professional") {
		rewritten = rewritten.replace(/!/g, ".");
	}
	return rewritten;
}

function formatCitation(source: CitationSource, style: "apa" | "mla"): string {
	const title = source.title?.trim() || "Untitled";
	const url = source.url?.trim() || "[No URL]";
	const site = source.site?.trim() || "Unknown site";
	const author = source.author?.trim();
	const published = source.publishedAt ? new Date(source.publishedAt) : undefined;
	const year = published && !Number.isNaN(published.getTime()) ? String(published.getUTCFullYear()) : "n.d.";
	const dateLabel = published && !Number.isNaN(published.getTime()) ? published.toISOString().slice(0, 10) : "n.d.";
	if (style === "apa") {
		return `${author ? `${author}. ` : ""}(${dateLabel}). ${title}. ${site}. ${url}`;
	}
	return `${author ? `${author}. ` : ""}\"${title}.\" ${site}, ${year}, ${url}`;
}

function buildImageSvg(description: string, title?: string): string {
	const width = 1200;
	const height = 630;
	const heading = title ?? "Buddy Visual";
	const lines = wrapPlainText(description, 46).slice(0, 8);
	const lineMarkup = lines
		.map(
			(line, index) =>
				`<text x="96" y="${180 + index * 42}" font-family="Inter, Arial, sans-serif" font-size="28" fill="#e2e8f0">${escapeXml(line)}</text>`,
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="28" fill="url(#bg)" />
  <circle cx="980" cy="170" r="84" fill="#22c55e" opacity="0.24" />
  <rect x="760" y="300" width="320" height="180" rx="24" fill="#111827" opacity="0.72" />
  <text x="96" y="100" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="700" fill="#ffffff">${escapeXml(heading)}</text>
  ${lineMarkup}
  <text x="96" y="570" font-family="monospace" font-size="22" fill="#bfdbfe">Generated by Buddy image_gen</text>
</svg>`;
}

function renderAsciiFrame(title: string, bodyLines: string[]): string {
	const width = Math.max(title.length, ...bodyLines.map((line) => line.length), 20) + 4;
	const border = `+${"-".repeat(width - 2)}+`;
	const titleLine = `| ${title.padEnd(width - 4)} |`;
	const body = bodyLines.map((line) => `| ${line.padEnd(width - 4)} |`).join("\n");
	return [border, titleLine, border, body, border].join("\n");
}

function asciiPlot(points: PlotPoint[], chartType: "line" | "bar" | "scatter"): string {
	const width = 40;
	const height = 10;
	const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
	const minX = Math.min(...points.map((point) => point.x));
	const maxX = Math.max(...points.map((point) => point.x));
	const minY = Math.min(...points.map((point) => point.y));
	const maxY = Math.max(...points.map((point) => point.y));
	const xRange = maxX - minX || 1;
	const yRange = maxY - minY || 1;
	const mapX = (x: number) => Math.max(0, Math.min(width - 1, Math.round(((x - minX) / xRange) * (width - 1))));
	const mapY = (y: number) => Math.max(0, Math.min(height - 1, Math.round((1 - (y - minY) / yRange) * (height - 1))));
	for (const point of points) {
		const x = mapX(point.x);
		const y = mapY(point.y);
		if (chartType === "bar") {
			for (let row = height - 1; row >= y; row--) {
				grid[row][x] = "#";
			}
		} else {
			grid[y][x] = chartType === "scatter" ? "o" : "*";
		}
	}
	return grid.map((row) => row.join("")).join("\n");
}

function asciiSparkline(values: number[]): string {
	const chars = "▁▂▃▄▅▆▇█";
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min || 1;
	return values
		.map((value) => {
			const index = Math.max(0, Math.min(chars.length - 1, Math.round(((value - min) / range) * (chars.length - 1))));
			return chars[index];
		})
		.join("");
}

function markdownToPlainText(markdown: string): string {
	return markdown
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^>\s?/gm, "")
		.replace(/^[-*+]\s+/gm, "• ")
		.replace(/^\d+\.\s+/gm, "• ")
		.replace(/\r/g, "")
		.trim();
}

function stripHtmlTags(text: string): string {
	return text.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

function escapePdfText(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildMinimalPdf(title: string, lines: string[]): Buffer {
	const width = 612;
	const height = 792;
	const contentLines = [
		"BT",
		"/F1 12 Tf",
		`72 ${height - 72} Td`,
		`(${escapePdfText(title)}) Tj`,
		"T*",
		...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
		"ET",
	].join("\n");
	const objects = [
		"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
		`2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj`,
		`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj`,
		"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
		`5 0 obj << /Length ${Buffer.byteLength(contentLines, "utf8")} >> stream\n${contentLines}\nendstream endobj`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [0];
	for (const object of objects) {
		offsets.push(Buffer.byteLength(pdf, "utf8"));
		pdf += `${object}\n`;
	}
	const xrefStart = Buffer.byteLength(pdf, "utf8");
	pdf += `xref\n0 ${objects.length + 1}\n`;
	pdf += "0000000000 65535 f \n";
	for (let i = 1; i < offsets.length; i++) {
		pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
	return Buffer.from(pdf, "utf8");
}

async function buildDocxFallback(markdown: string, outputPath: string): Promise<void> {
	const zip = new JSZip();
	const text = markdownToPlainText(markdown);
	const paragraphs = text
		.split(/\r?\n\s*\r?\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
		.flatMap((paragraph) => paragraph.split(/\r?\n/).map((line) => line.trim()))
		.filter((line) => line.length > 0);
	const runs = paragraphs
		.map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
		.join("");
	const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  mc:Ignorable="w14 wp14">
  <w:body>${runs || `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text || "(empty)")}</w:t></w:r></w:p>`}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>
</w:document>`;
	zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
	zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
	zip.folder("word")?.file("document.xml", documentXml);
	const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
	await writeFile(outputPath, buffer);
}

function asciiTree(root: string, branches: string[]): string {
	const lines = [`${root}`];
	branches.forEach((branch, index) => {
		lines.push(`${index === branches.length - 1 ? "`--" : "|--"} ${branch}`);
	});
	return lines.join("\n");
}

function extractTopics(text: string): string[] {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
		.filter((line) => line.length > 0);
	if (lines.length > 0) return lines.slice(0, 10);
	const candidates = unique(
		(text.match(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\b/g) ?? []).map((value) => value.trim()),
	);
	return candidates.slice(0, 10);
}

function sentimentReport(text: string): { mood: string; polarity: number; bias: number; positives: string[]; negatives: string[] } {
	const positiveLexicon = ["good", "great", "excellent", "strong", "success", "positive", "improve", "benefit"];
	const negativeLexicon = ["bad", "poor", "weak", "fail", "negative", "risk", "decline", "problem"];
	const biasLexicon = ["clearly", "obviously", "undeniable", "disaster", "amazing", "shocking", "propaganda"];
	const lower = text.toLowerCase();
	const positives = positiveLexicon.filter((word) => lower.includes(word));
	const negatives = negativeLexicon.filter((word) => lower.includes(word));
	const biasHits = biasLexicon.filter((word) => lower.includes(word));
	const polarity = positives.length - negatives.length;
	const mood = polarity > 1 ? "positive" : polarity < -1 ? "negative" : "neutral";
	return { mood, polarity, bias: biasHits.length, positives, negatives };
}

function extractEntities(text: string): { names: string[]; dates: string[]; locations: string[]; urls: string[]; emails: string[] } {
	const names = unique(text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) ?? []).slice(0, 50);
	const isoDates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
	const longDates = text.match(/\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/g) ?? [];
	const locations = unique(Array.from(text.matchAll(/\b(?:in|at|from|to|near)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/g), (match) => match[1] ?? "")).slice(0, 50);
	const urls = unique(text.match(/https?:\/\/[^\s)]+/g) ?? []);
	const emails = unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []);
	return { names, dates: unique([...isoDates, ...longDates]), locations, urls, emails };
}

function resolveOutputPath(cwd: string, outputPath: string): string {
	return resolve(cwd, outputPath);
}

function renderTodoText(items: TodoItem[]): string {
	const lines = items.length === 0 ? ["No todo items."] : items.map((item) => `${item.done ? "[x]" : "[ ]"} #${item.id} ${item.text}`);
	return renderAsciiFrame("Todo List", lines);
}

function renderTodoStatus(message: string, items: TodoItem[]): string {
	return `${renderAsciiFrame("Todo Update", [message])}\n\n${renderTodoText(items)}`;
}

const todoUpdateTool = defineTool({
	name: "todo_update",
	label: "Todo Update",
	description: "Maintain an internal task list for long-running agent loops.",
	promptSnippet: "Maintain a running todo list for multi-step work.",
	parameters: Type.Object({
		action: StringEnum(["list", "add", "toggle", "remove", "clear", "replace"] as const),
		text: Type.Optional(Type.String()),
		id: Type.Optional(Type.Number()),
		items: Type.Optional(Type.Array(Type.String())),
	}),
	async execute(_toolCallId, params) {
		switch (params.action) {
			case "list":
				return { content: [{ type: "text", text: renderTodoText(todoItems) }], details: { action: "list", todos: [...todoItems], nextId: nextTodoId } as TodoToolDetails };
			case "add": {
				if (!params.text?.trim()) {
					return { content: [{ type: "text", text: "Error: text is required for add." }], details: { action: "add", todos: [...todoItems], nextId: nextTodoId, error: "text required" } as TodoToolDetails, isError: true };
				}
				const item: TodoItem = { id: nextTodoId++, text: params.text.trim(), done: false };
				todoItems.push(item);
				return { content: [{ type: "text", text: renderTodoStatus(`Added todo #${item.id}: ${item.text}`, todoItems) }], details: { action: "add", todos: [...todoItems], nextId: nextTodoId } as TodoToolDetails };
			}
			case "toggle": {
				const item = todoItems.find((entry) => entry.id === params.id);
				if (!item) {
					return { content: [{ type: "text", text: `Todo #${params.id ?? "?"} not found.` }], details: { action: "toggle", todos: [...todoItems], nextId: nextTodoId, error: "id not found" } as TodoToolDetails, isError: true };
				}
				item.done = !item.done;
				return { content: [{ type: "text", text: renderTodoStatus(`Todo #${item.id} marked ${item.done ? "done" : "open"}.`, todoItems) }], details: { action: "toggle", todos: [...todoItems], nextId: nextTodoId } as TodoToolDetails };
			}
			case "remove": {
				const index = todoItems.findIndex((entry) => entry.id === params.id);
				if (index < 0) {
					return { content: [{ type: "text", text: `Todo #${params.id ?? "?"} not found.` }], details: { action: "remove", todos: [...todoItems], nextId: nextTodoId, error: "id not found" } as TodoToolDetails, isError: true };
				}
				const [removed] = todoItems.splice(index, 1);
				return { content: [{ type: "text", text: renderTodoStatus(`Removed todo #${removed.id}: ${removed.text}`, todoItems) }], details: { action: "remove", todos: [...todoItems], nextId: nextTodoId } as TodoToolDetails };
			}
			case "clear":
				todoItems.length = 0;
				nextTodoId = 1;
				return { content: [{ type: "text", text: renderTodoStatus("Cleared all todo items.", todoItems) }], details: { action: "clear", todos: [], nextId: nextTodoId } as TodoToolDetails };
			case "replace":
				todoItems.length = 0;
				nextTodoId = 1;
				for (const text of params.items ?? []) {
					todoItems.push({ id: nextTodoId++, text, done: false });
				}
				return { content: [{ type: "text", text: renderTodoStatus("Replaced todo list.", todoItems) }], details: { action: "replace", todos: [...todoItems], nextId: nextTodoId } as TodoToolDetails };
		}
	},
});

const plotTool = defineTool({
	name: "plot",
	label: "Plot",
	description: "Generate line, bar, or scatter charts from arrays or CSV data and save as SVG images.",
	promptSnippet: "Generate charts from JSON arrays or CSV data and save them as SVG images.",
	parameters: Type.Object({
		chartType: StringEnum(["line", "bar", "scatter"] as const),
		dataJson: Type.Optional(Type.String()),
		csv: Type.Optional(Type.String()),
		path: Type.Optional(Type.String()),
		xKey: Type.Optional(Type.String()),
		yKey: Type.Optional(Type.String()),
		title: Type.Optional(Type.String()),
		outputPath: Type.String({ description: "Relative output image path, for example reports/chart.svg" }),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const data = await loadDataset(ctx.cwd, { dataJson: params.dataJson, csv: params.csv, path: params.path });
		const points = toPlotPoints(data, params.xKey, params.yKey);
		if (points.length === 0) {
			return { content: [{ type: "text", text: "No plot points could be derived from the dataset." }], details: {}, isError: true };
		}
		const title = params.title ?? `${params.chartType} chart`;
		const svg = createPlotSvg(params.chartType, points, title);
		const outputPath = resolveOutputPath(ctx.cwd, params.outputPath);
		await writeFile(outputPath, svg, "utf8");
		const preview = asciiPlot(points, params.chartType);
		return {
			content: [{ type: "text", text: renderAsciiFrame(title, [preview, `Saved: ${outputPath}`]) }],
			details: { outputPath, points: points.length, preview },
		};
	},
});

const dataSummarizeTool = defineTool({
	name: "data_summarize",
	label: "Data Summarize",
	description: "Perform statistical analysis on a dataset, including mean, trends, and outliers.",
	promptSnippet: "Compute statistical summaries, trends, and outliers for numeric data.",
	parameters: Type.Object({
		dataJson: Type.Optional(Type.String()),
		csv: Type.Optional(Type.String()),
		path: Type.Optional(Type.String()),
		column: Type.Optional(Type.String()),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const data = await loadDataset(ctx.cwd, { dataJson: params.dataJson, csv: params.csv, path: params.path });
		const values = toNumericSeries(data, params.column);
		if (values.length === 0) {
			return { content: [{ type: "text", text: "No numeric values found for analysis." }], details: {}, isError: true };
		}
		const points = values.map((value, index) => ({ x: index + 1, y: value }));
		const avg = mean(values);
		const med = median(values);
		const stdDev = standardDeviation(values);
		const slope = linearRegressionSlope(points);
		const outliers = values.filter((value) => stdDev > 0 && Math.abs((value - avg) / stdDev) >= 2.5);
		const trend = slope > 0.1 ? "increasing" : slope < -0.1 ? "decreasing" : "stable";
		const sparkline = asciiSparkline(values);
		const text = [
			`Count: ${values.length}`,
			`Mean: ${avg.toFixed(4)}`,
			`Median: ${med.toFixed(4)}`,
			`Min / Max: ${Math.min(...values).toFixed(4)} / ${Math.max(...values).toFixed(4)}`,
			`Std Dev: ${stdDev.toFixed(4)}`,
			`Trend: ${trend} (slope ${slope.toFixed(4)})`,
			`Outliers: ${outliers.length === 0 ? "none" : outliers.map((value) => value.toFixed(4)).join(", ")}`,
			"",
			`Sparkline: ${sparkline}`,
		].join("\n");
		return { content: [{ type: "text", text: renderAsciiFrame("Dataset Summary", text.split("\n")) }], details: { count: values.length, mean: avg, median: med, stdDev, slope, trend, outliers, sparkline } };
	},
});

const tableFormatTool = defineTool({
	name: "table_format",
	label: "Table Format",
	description: "Convert raw JSON or CSV data into polished Markdown or HTML tables.",
	promptSnippet: "Convert JSON or CSV datasets into Markdown or HTML tables.",
	parameters: Type.Object({
		dataJson: Type.Optional(Type.String()),
		csv: Type.Optional(Type.String()),
		path: Type.Optional(Type.String()),
		format: StringEnum(["markdown", "html"] as const),
		outputPath: Type.Optional(Type.String()),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const data = await loadDataset(ctx.cwd, { dataJson: params.dataJson, csv: params.csv, path: params.path });
		const rows = toTableRows(data);
		const rendered = params.format === "markdown" ? rowsToMarkdown(rows) : rowsToHtml(rows);
		const ascii = rowsToAsciiTable(rows);
		if (params.outputPath) {
			const outputPath = resolveOutputPath(ctx.cwd, params.outputPath);
			await writeFile(outputPath, rendered, "utf8");
			return { content: [{ type: "text", text: `${renderAsciiFrame("Table Preview", ascii.split("\n"))}\n\n${rendered}` }], details: { outputPath, rows: rows.length, ascii } };
		}
		return { content: [{ type: "text", text: `${renderAsciiFrame("Table Preview", ascii.split("\n"))}\n\n${rendered}` }], details: { rows: rows.length, ascii } };
	},
});

const docExportToolFactory = (buddy: ExtensionAPI) =>
	defineTool({
		name: "doc_export",
		label: "Doc Export",
		description: "Convert Markdown files into .docx or .pdf using pandoc, with a pure TS fallback.",
		promptSnippet: "Export Markdown documents to .docx or .pdf using templates when available.",
		parameters: Type.Object({
			path: Type.String({ description: "Relative Markdown file path." }),
			format: StringEnum(["docx", "pdf"] as const),
			outputPath: Type.Optional(Type.String()),
			templatePath: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const inputPath = resolve(ctx.cwd, params.path);
			const defaultOutput = `${inputPath.replace(/\.md$/i, "")}.${params.format}`;
			const outputPath = resolve(ctx.cwd, params.outputPath ?? defaultOutput);
			const markdown = await readFile(inputPath, "utf8");
			const args = [inputPath, "-o", outputPath];
			if (params.templatePath) {
				const templatePath = resolve(ctx.cwd, params.templatePath);
				if (params.format === "docx") {
					args.push(`--reference-doc=${templatePath}`);
				} else {
					args.push(`--template=${templatePath}`);
				}
			}

			try {
				const result = await buddy.exec("pandoc", args);
				if (result.code === 0) {
					return {
						content: [{ type: "text", text: `Exported document to ${outputPath}` }],
						details: { outputPath, stdout: result.stdout, fallback: false },
					};
				}
			} catch {
				// fall back to pure TS implementation below
			}

			if (params.format === "docx") {
				await buildDocxFallback(markdown, outputPath);
				return {
					content: [{ type: "text", text: renderAsciiFrame("Doc Export", ["DOCX fallback", outputPath, params.templatePath ? `template: ${params.templatePath}` : "no template"]) }],
					details: { outputPath, fallback: true, format: "docx" },
				};
			}

			const plainText = markdownToPlainText(markdown);
			const wrapped = wrapPlainText(plainText, 72).slice(0, 52);
			const pdf = buildMinimalPdf(basename(inputPath), wrapped.length > 0 ? wrapped : [plainText || "(empty)"]);
			await writeFile(outputPath, pdf);
			return {
				content: [{ type: "text", text: renderAsciiFrame("Doc Export", ["PDF fallback", outputPath, params.templatePath ? `template: ${params.templatePath}` : "no template"]) }],
				details: { outputPath, fallback: true, format: "pdf" },
			};
		},
	});

const contentRewriteTool = defineTool({
	name: "content_rewrite",
	label: "Content Rewrite",
	description: "Adjust tone, brevity, or reading level of a text block.",
	promptSnippet: "Rewrite text for a requested tone, brevity, or reading level.",
	parameters: Type.Object({
		text: Type.String(),
		tone: StringEnum(["professional", "executive_summary", "friendly", "plain"] as const),
		brevity: Type.Optional(StringEnum(["shorter", "same", "longer"] as const, { default: "same" })),
		readingLevel: Type.Optional(StringEnum(["simple", "general", "expert"] as const, { default: "general" })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const activeModel: Model<Api> | undefined = ctx.model ?? getModel("openai", "gpt-4o");
		if (activeModel) {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(activeModel);
			if (auth.ok && auth.apiKey) {
				const prompt = [
					"Rewrite the following text.",
					`Tone: ${params.tone}`,
					`Brevity: ${params.brevity ?? "same"}`,
					`Reading level: ${params.readingLevel ?? "general"}`,
					"Return only the rewritten text.",
					"<text>",
					params.text,
					"</text>",
				].join("\n");
				const response = await complete(
					activeModel,
					{ messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] },
					{ apiKey: auth.apiKey, headers: auth.headers },
				);
				const rewritten = response.content
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join("\n")
					.trim();
				if (rewritten.length > 0) {
					return { content: [{ type: "text", text: rewritten }], details: { model: activeModel.id, provider: activeModel.provider } };
				}
			}
		}
		const rewritten = heuristicRewrite(params.text, params.tone, params.brevity ?? "same", params.readingLevel ?? "general");
		return { content: [{ type: "text", text: rewritten }], details: { fallback: true } };
	},
});

const citeSourcesTool = defineTool({
	name: "cite_sources",
	label: "Cite Sources",
	description: "Format web results or source metadata into APA or MLA citations.",
	promptSnippet: "Format source lists into APA or MLA citations.",
	parameters: Type.Object({
		sourcesJson: Type.String({ description: "JSON array of source objects" }),
		style: StringEnum(["apa", "mla"] as const),
		outputPath: Type.Optional(Type.String()),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const sources = JSON.parse(params.sourcesJson) as CitationSource[];
		const citations = sources.map((source) => formatCitation(source, params.style));
		const output = citations.join("\n");
		const preview = renderAsciiFrame("Citations", citations.length > 0 ? citations.slice(0, 8) : ["No sources"]);
		if (params.outputPath) {
			const outputPath = resolveOutputPath(ctx.cwd, params.outputPath);
			await writeFile(outputPath, output, "utf8");
			return { content: [{ type: "text", text: `${preview}\n\n${output}` }], details: { outputPath, count: citations.length } };
		}
		return { content: [{ type: "text", text: `${preview}\n\n${output}` }], details: { count: citations.length } };
	},
});

const imageGenTool = defineTool({
	name: "image_gen",
	label: "Image Gen",
	description: "Create simple SVG visual assets or diagrams from text descriptions.",
	promptSnippet: "Generate simple SVG visual assets from text descriptions.",
	parameters: Type.Object({
		description: Type.String(),
		outputPath: Type.String(),
		title: Type.Optional(Type.String()),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const svg = buildImageSvg(params.description, params.title);
		const outputPath = resolveOutputPath(ctx.cwd, params.outputPath);
		await writeFile(outputPath, svg, "utf8");
		const ascii = renderAsciiFrame(params.title ?? "Image Preview", wrapPlainText(params.description, 28).slice(0, 6));
		return { content: [{ type: "text", text: `${ascii}\n\nSaved SVG visual to ${outputPath}` }], details: { outputPath } };
	},
});

const mindmapGenTool = defineTool({
	name: "mindmap_gen",
	label: "Mindmap Gen",
	description: "Generate Mermaid or DOT diagrams for researched topic connections.",
	promptSnippet: "Generate Mermaid or DOT diagrams representing topic connections.",
	parameters: Type.Object({
		centralTopic: Type.Optional(Type.String()),
		branchesJson: Type.Optional(Type.String()),
		text: Type.Optional(Type.String()),
		format: StringEnum(["mermaid", "dot"] as const),
		outputPath: Type.Optional(Type.String()),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const rawBranches = params.branchesJson ? JSON.parse(params.branchesJson) : extractTopics(params.text ?? "");
		const branches = (rawBranches as any[]).map((item) => {
			if (typeof item === "string") return item;
			if (item && typeof item === "object") return String(item.name ?? item.text ?? item.label ?? JSON.stringify(item));
			return String(item);
		});
		const root = params.centralTopic ?? "Research Topic";
		const body =
			params.format === "mermaid"
				? [
					"graph TD",
					`  root[\"${root.replace(/"/g, "'")}\"]`,
					...branches.map((branch, index) => `  root --> b${index}[\"${branch.replace(/"/g, "'")}\"]`),
				].join("\n")
				: [
					"digraph G {",
					`  root [label=\"${root.replace(/"/g, "'")}\"];`,
					...branches.map((branch, index) => `  b${index} [label=\"${branch.replace(/"/g, "'")}\"];\n  root -> b${index};`),
					"}",
				].join("\n");
		const preview = asciiTree(root, branches);
		if (params.outputPath) {
			const outputPath = resolveOutputPath(ctx.cwd, params.outputPath);
			await writeFile(outputPath, body, "utf8");
			return { content: [{ type: "text", text: `${renderAsciiFrame("Mindmap", preview.split("\n"))}\n\n${body}` }], details: { outputPath, branches: branches.length, preview } };
		}
		return { content: [{ type: "text", text: `${renderAsciiFrame("Mindmap", preview.split("\n"))}\n\n${body}` }], details: { branches: branches.length, preview } };
	},
});

const sentimentAnalyzeTool = defineTool({
	name: "sentiment_analyze",
	label: "Sentiment Analyze",
	description: "Estimate mood and rhetorical bias in text or documents.",
	promptSnippet: "Evaluate mood and potential bias in fetched articles or documents.",
	parameters: Type.Object({
		text: Type.Optional(Type.String()),
		path: Type.Optional(Type.String()),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const text = params.text ?? (params.path ? await readFile(resolve(ctx.cwd, params.path), "utf8") : undefined);
		if (!text) {
			return { content: [{ type: "text", text: "Provide text or path." }], details: {}, isError: true };
		}
		const report = sentimentReport(text);
		const meter = `${report.polarity > 0 ? "+" : report.polarity < 0 ? "-" : "="}${"#".repeat(Math.min(10, Math.abs(report.polarity) + report.bias))}`;
		const summary = [
			`Mood: ${report.mood}`,
			`Polarity score: ${report.polarity}`,
			`Bias indicator count: ${report.bias}`,
			`Positive markers: ${report.positives.join(", ") || "none"}`,
			`Negative markers: ${report.negatives.join(", ") || "none"}`,
			`Meter: ${meter}`,
		].join("\n");
		return { content: [{ type: "text", text: renderAsciiFrame("Sentiment", summary.split("\n")) }], details: { ...report, meter } };
	},
});

const entityExtractTool = defineTool({
	name: "entity_extract",
	label: "Entity Extract",
	description: "Extract names, dates, locations, URLs, and emails from large text dumps.",
	promptSnippet: "Extract names, dates, locations, and links from large text inputs.",
	parameters: Type.Object({
		text: Type.Optional(Type.String()),
		path: Type.Optional(Type.String()),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const text = params.text ?? (params.path ? await readFile(resolve(ctx.cwd, params.path), "utf8") : undefined);
		if (!text) {
			return { content: [{ type: "text", text: "Provide text or path." }], details: {}, isError: true };
		}
		const entities = extractEntities(text);
		const summary = [
			`Names: ${entities.names.length}`,
			`Dates: ${entities.dates.length}`,
			`Locations: ${entities.locations.length}`,
			`URLs: ${entities.urls.length}`,
			`Emails: ${entities.emails.length}`,
		].join("\n");
		return {
			content: [{ type: "text", text: `${renderAsciiFrame("Entities", summary.split("\n"))}\n\n${JSON.stringify(entities, null, 2)}` }],
			details: entities,
		};
	},
});

function reconstructTodos(ctx: ExtensionContext): void {
	todoItems.length = 0;
	nextTodoId = 1;
	for (const entry of ctx.sessionManager.getBranch()) {
		// Tool-result style persistence (from tool calls)
		if (entry.type === "message") {
			const message = entry.message as any;
			if (message.role === "toolResult" && (message.toolName === "todo_update" || message.toolName === "todo")) {
				const details = message.details as TodoToolDetails | undefined;
				if (details) {
					todoItems.length = 0;
					todoItems.push(...details.todos);
					nextTodoId = details.nextId;
				}
			}
		}

		// Custom session entry persistence (from automatic detection)
		if (entry.type === "custom" && (entry.customType === "buddy-todos" || entry.customType === "plan-mode")) {
			const data: any = entry.data ?? {};
			if (Array.isArray(data.todos)) {
				todoItems.length = 0;
				for (const t of data.todos) {
					if (typeof t.text === "string") {
						todoItems.push({ id: typeof t.id === "number" ? t.id : nextTodoId++, text: t.text, done: !!t.done });
					}
				}
			}
		}
	}
}

async function showTodoDialog(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) return;
	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Buddy Todos")), 1, 0));
		container.addChild(new Text(renderTodoText(todoItems), 1, 1));
		container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("muted", s)));
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
					done(undefined);
				}
			},
		};
	});
}

export default function buddyToolkitExtension(buddy: ExtensionAPI) {
	buddy.registerTool(todoUpdateTool);
	buddy.registerTool(plotTool);
	buddy.registerTool(dataSummarizeTool);
	buddy.registerTool(tableFormatTool);
	buddy.registerTool(docExportToolFactory(pi));
	buddy.registerTool(contentRewriteTool);
	buddy.registerTool(citeSourcesTool);
	buddy.registerTool(imageGenTool);
	buddy.registerTool(mindmapGenTool);
	buddy.registerTool(sentimentAnalyzeTool);
	buddy.registerTool(entityExtractTool);

	buddy.registerCommand("buddy-todos", {
		description: "Show the Buddy todo list used for long-running agent loops.",
		handler: async (_args, ctx) => {
			await showTodoDialog(ctx);
		},
	});

	buddy.on("session_start", async (_event, ctx) => {
		reconstructTodos(ctx);
	});

	buddy.on("session_tree", async (_event, ctx) => {
		reconstructTodos(ctx);
	});
}
