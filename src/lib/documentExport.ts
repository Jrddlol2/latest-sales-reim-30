export interface ExportSection {
  heading: string;
  rows?: Array<[label: string, value: string]>;
  paragraphs?: string[];
}

const safeFilename = (value: string) =>
  value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '') || 'export';

export const escapeExportHtml = (value?: string | number) =>
  String(value ?? '—')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function exportStructuredWord(
  filename: string,
  title: string,
  subtitle: string,
  sections: ExportSection[],
) {
  const sectionHtml = sections.map(section => `
    <section>
      <h2>${escapeExportHtml(section.heading)}</h2>
      ${section.rows?.length ? `<table>${section.rows.map(([label, value]) =>
        `<tr><th>${escapeExportHtml(label)}</th><td>${escapeExportHtml(value)}</td></tr>`
      ).join('')}</table>` : ''}
      ${section.paragraphs?.map(paragraph => `<p>${escapeExportHtml(paragraph)}</p>`).join('') || ''}
    </section>
  `).join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeExportHtml(title)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#172033;max-width:820px;margin:40px auto;line-height:1.5}
    h1{color:#123b72;margin:0 0 4px}.subtitle{color:#667085;margin-bottom:28px}
    section{margin-top:24px}h2{font-size:16px;color:#123b72;border-bottom:2px solid #123b72;padding-bottom:5px}
    table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d0d5dd;padding:9px;text-align:left;vertical-align:top}
    th{width:210px;background:#f2f4f7;color:#344054}p{white-space:pre-wrap}
  </style>
</head>
<body>
  <h1>${escapeExportHtml(title)}</h1>
  <div class="subtitle">${escapeExportHtml(subtitle)}</div>
  ${sectionHtml}
</body>
</html>`;

  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFilename(filename)}.doc`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Builds the PDF and returns its bytes as a Blob, without saving anything.
 * The one source of truth for PDF *generation* — exportStructuredPdf below
 * calls this then triggers a download; the client-copy preview modal calls
 * it directly to render the exact same bytes in an <iframe> instead of a
 * separate HTML approximation.
 */
export async function buildStructuredPdfBlob(
  title: string,
  subtitle: string,
  sections: ExportSection[],
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (height: number) => {
    if (y + height <= pageHeight - margin) return;
    pdf.addPage();
    y = margin;
  };

  const writeLines = (text: string, size = 10, color: [number, number, number] = [52, 64, 84]) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(text || '—', contentWidth);
    const lineHeight = size * 1.45;
    ensureSpace(lines.length * lineHeight + 4);
    pdf.text(lines, margin, y);
    y += lines.length * lineHeight + 4;
  };

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(18, 59, 114);
  pdf.text(title, margin, y);
  y += 24;
  writeLines(subtitle, 10, [102, 112, 133]);
  y += 10;

  for (const section of sections) {
    ensureSpace(42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(18, 59, 114);
    pdf.text(section.heading, margin, y);
    y += 8;
    pdf.setDrawColor(18, 59, 114);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 16;

    for (const [label, value] of section.rows || []) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(71, 84, 103);
      const labelText = `${label}:`;
      ensureSpace(18);
      pdf.text(labelText, margin, y);
      const labelWidth = Math.min(150, pdf.getTextWidth(labelText) + 12);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(25, 27, 35);
      const lines = pdf.splitTextToSize(value || '—', contentWidth - labelWidth);
      pdf.text(lines, margin + labelWidth, y);
      y += Math.max(14, lines.length * 13) + 3;
    }

    for (const paragraph of section.paragraphs || []) {
      writeLines(paragraph);
      y += 5;
    }
    y += 8;
  }

  return pdf.output('blob');
}

export async function exportStructuredPdf(
  filename: string,
  title: string,
  subtitle: string,
  sections: ExportSection[],
) {
  const blob = await buildStructuredPdfBlob(title, subtitle, sections);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFilename(filename)}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
