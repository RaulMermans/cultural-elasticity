"use client";

/** Saves a research report as HTML or PDF in the browser. Nothing is sent anywhere. */
import { renderReportHtml, reportFileName, type NetworkReport } from "./network-report.ts";

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadReportHtml(report: NetworkReport) {
  save(new Blob([renderReportHtml(report)], { type: "text/html;charset=utf-8" }), reportFileName(report.brand, report.generatedAt, "html"));
}

export async function downloadReportPdf(report: NetworkReport) {
  const { jsPDF } = await import("jspdf");
  buildReportPdf(report, new jsPDF({ unit: "pt", format: "a4" })).save(reportFileName(report.brand, report.generatedAt, "pdf"));
}

type Pdf = InstanceType<typeof import("jspdf").jsPDF>;

/** A text PDF laid out page by page (selectable, searchable), from the same report as the HTML. */
export function buildReportPdf(report: NetworkReport, pdf: Pdf): Pdf {
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 54;
  const usable = width - margin * 2;
  let y = margin;
  // The standard PDF fonts cover Latin-1; typographic quotes and other characters are mapped to plain ones.
  const plain = (text: string) => text.replace(/[“”]/gu, '"').replace(/[‘’]/gu, "'").replace(/[–—]/gu, "-").replace(/×/gu, "x").replace(/…/gu, "...").replace(/./gu, (char) => (char.codePointAt(0)! > 0xff ? "?" : char));
  const ensure = (needed: number) => { if (y + needed > height - margin) { pdf.addPage(); y = margin; } };
  const write = (text: string, options: { size?: number; style?: "normal" | "bold" | "italic"; color?: [number, number, number]; indent?: number; gap?: number; font?: "helvetica" | "times" } = {}) => {
    const size = options.size ?? 10.5;
    pdf.setFont(options.font ?? "helvetica", options.style ?? "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...(options.color ?? [26, 22, 18]));
    const lines = pdf.splitTextToSize(plain(text), usable - (options.indent ?? 0)) as string[];
    for (const line of lines) {
      ensure(size * 1.4);
      pdf.text(line, margin + (options.indent ?? 0), y);
      y += size * 1.4;
    }
    y += options.gap ?? 4;
  };

  write(`CULTURAL ELASTICITY · RESEARCH REPORT · ${report.origin.toUpperCase()}`, { size: 8, color: [122, 111, 99] });
  write(report.brand, { size: 28, font: "times", style: "bold", gap: 2 });
  write(`Generated ${report.stamp.local} · ${report.stamp.iso}`, { size: 9, color: [74, 66, 58], gap: 10 });
  write(report.stats.map((stat) => `${stat.label}: ${stat.value}`).join("   ·   "), { size: 9.5, style: "bold", color: [147, 73, 43], gap: 12 });

  write("Summary", { size: 16, font: "times", style: "bold" });
  for (const line of report.summary) write(line, { gap: 5 });
  y += 6;

  for (const section of report.sections) {
    ensure(60);
    y += 6;
    pdf.setDrawColor(227, 217, 199);
    pdf.line(margin, y - 12, width - margin, y - 12);
    write(section.title, { size: 16, font: "times", style: "bold" });
    if (section.intro) write(section.intro, { color: [74, 66, 58], style: "italic" });
    for (const block of section.blocks) {
      ensure(40);
      if (block.heading) write(block.heading, { size: 11.5, style: "bold", gap: 1 });
      if (block.meta) write(block.meta, { size: 9.5, style: "bold", color: [74, 122, 88], gap: 2 });
      if (block.text) write(block.text, { gap: 2 });
      for (const bullet of block.bullets ?? []) write(`-  ${bullet}`, { indent: 10, size: 10, gap: 1 });
      y += 6;
    }
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(122, 111, 99);
    pdf.text(plain(`${report.brand} · ${report.stamp.local} · page ${page} of ${pages}`), margin, height - 28);
  }
  return pdf;
}
