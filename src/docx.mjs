import { createZip } from "./zip.mjs";
import { REFLECTION_LABELS } from "./requirements.mjs";

const escapeXml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const paragraph = (text, style = "Normal") =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

const tableCell = (text, width, bold = false, span = 1) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}<w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;

function makeDocument(body, landscape = false) {
  const page = landscape
    ? '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="540" w:bottom="720" w:left="540" w:header="360" w:footer="360" w:gutter="0"/>'
    : '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="450" w:footer="450" w:gutter="0"/>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr>${page}</w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="20"/><w:color w:val="173437"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="40"/><w:b/><w:color w:val="123C3F"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:sz w:val="26"/><w:b/><w:color w:val="1D7774"/></w:rPr></w:style></w:styles>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return createZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: documentXml },
    { name: "word/styles.xml", data: styles },
    { name: "word/_rels/document.xml.rels", data: docRels }
  ]);
}

export function generateLogbookDocx(state, audit) {
  const widths = [1250, 2200, 1500, 2450, 900, 900, 1200, 1450];
  const header = ["Date", "Name of activity", "Location", "Source / provider / facilitator", "Substantive", "General", "Evidence?", "Reflection?"];
  const rows = state.activities
    .filter((activity) => audit.years.includes(Number(activity.activityYear)))
    .sort((a, b) => a.activityDate.localeCompare(b.activityDate))
    .map((activity) => {
      const values = [
        activity.activityDate,
        activity.name,
        activity.location || "—",
        activity.provider || "—",
        activity.type === "substantive" ? activity.hours : "",
        activity.type === "general" ? activity.hours : "",
        activity.attachments.length ? "Yes" : "No",
        activity.reflections.length ? "Yes" : "No"
      ];
      return `<w:tr>${values.map((value, index) => tableCell(value, widths[index])).join("")}</w:tr>`;
    });
  rows.push(`<w:tr>${[
    tableCell("TOTALS", widths.slice(0, 4).reduce((sum, value) => sum + value, 0), true, 4),
    tableCell(audit.totals.substantive, widths[4], true),
    tableCell(audit.totals.general, widths[5], true),
    tableCell(audit.selectedEvidence.length, widths[6], true),
    tableCell(audit.selectedReflections.length, widths[7], true)
  ].join("")}</w:tr>`);
  const table = `<w:tbl><w:tblPr><w:tblW w:w="11850" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="9CB5B1"/><w:left w:val="single" w:sz="6" w:color="9CB5B1"/><w:bottom w:val="single" w:sz="6" w:color="9CB5B1"/><w:right w:val="single" w:sz="6" w:color="9CB5B1"/><w:insideH w:val="single" w:sz="4" w:color="CBD6D3"/><w:insideV w:val="single" w:sz="4" w:color="CBD6D3"/></w:tblBorders></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid><w:tr>${header.map((value, index) => tableCell(value, widths[index], true)).join("")}</w:tr>${rows.join("")}</w:tbl>`;
  const body = [
    paragraph("MRTB CPD Logbook", "Title"),
    paragraph(`${state.settings.fullName || "Practitioner"} · Registration ${state.settings.registrationNumber || "not recorded"}`),
    paragraph(`Biennium ${audit.years[0]}–${audit.years[1]} · Generated ${new Date().toLocaleDateString("en-NZ")}`),
    table
  ].join("");
  return makeDocument(body, true);
}

export function generateReflectionDocx(state, reflection) {
  const activity = state.activities.find((item) => item.id === reflection.activityId);
  const body = [
    paragraph(REFLECTION_LABELS[reflection.category] || "Reflective statement", "Title"),
    paragraph(`${state.settings.fullName || "Practitioner"} · Registration ${state.settings.registrationNumber || "not recorded"}`),
    paragraph(`CPD activity: ${activity?.name || "Linked activity"}`, "Heading1"),
    paragraph(`Activity date: ${activity?.activityDate || "Not recorded"}`),
    paragraph("What did I do?", "Heading1"),
    paragraph(reflection.did),
    paragraph("What did I learn?", "Heading1"),
    paragraph(reflection.learned),
    paragraph("How did this affect my practice?", "Heading1"),
    paragraph(reflection.impact),
    ...(reflection.furtherLearning ? [paragraph("What further learning could I undertake?", "Heading1"), paragraph(reflection.furtherLearning)] : [])
  ].join("");
  return makeDocument(body, false);
}
