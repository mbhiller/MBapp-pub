import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import MarkdownIt from 'markdown-it';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();
program
  .requiredOption('--md <path>', 'Path to roadmap markdown')
  .requiredOption('--logo <path>', 'Path to SVG/PNG logo for title + watermark')
  .requiredOption('--out <path>', 'Output PDF path')
  .option('--title <string>', 'Title', 'MBapp Roadmap vNext — Equestrian Operations Platform')
  .option('--subtitle <string>', 'Subtitle', 'Executive & Technical Master Plan')
  .option('--orientation <string>', 'portrait|landscape', 'landscape')
  .option('--wmRotate <number>', 'Watermark rotation degrees', '30')
  .option('--wmOpacity <number>', 'Watermark opacity (0–1)', '0.15');

program.parse(process.argv);
const opts = program.opts();

const read = (p) => readFile(p, 'utf8');
const encodeDataUrl = (buf, mime) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;

async function main() {
  const mdPath = path.resolve(process.cwd(), opts.md);
  const logoPath = path.resolve(process.cwd(), opts.logo);
  const outPdf = path.resolve(process.cwd(), opts.out);
  const outDir = path.dirname(outPdf);
  await mkdir(outDir, { recursive: true });

  const [mdRaw, logoBuf, template, css] = await Promise.all([
    read(mdPath),
    readFile(logoPath),
    read(path.join(__dirname, 'template.html')),
    read(path.join(__dirname, 'theme.css'))
  ]);

  // Determine logo mime
  const ext = path.extname(logoPath).toLowerCase();
  const mime = ext === '.svg' ? 'image/svg+xml'
            : ext === '.png' ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : 'application/octet-stream';
  const logoDataUrl = encodeDataUrl(logoBuf, mime);

  // Markdown -> HTML
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  const bodyHtml = md.render(mdRaw);

  // Inject into template
  const html = template
    .replace(/{{TITLE}}/g, opts.title)
    .replace(/{{SUBTITLE}}/g, opts.subtitle)
    .replace(/{{LOGO_DATAURL}}/g, logoDataUrl)
    .replace(/{{WATERMARK_ROTATE}}/g, String(opts.wmRotate))
    .replace(/{{WATERMARK_OPACITY}}/g, String(opts.wmOpacity))
    .replace(/{{ORIENTATION}}/g, opts.orientation)
    .replace(/{{THEME_CSS}}/g, css)
    .replace(/{{BODY_HTML}}/g, bodyHtml);

  const htmlOut = outPdf.replace(/\.pdf$/i, '.html');
  await writeFile(htmlOut, html, 'utf8');

  // Render to PDF via headless Chrome
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const landscape = opts.orientation === 'landscape';
  await page.pdf({
    path: outPdf,
    printBackground: true,
    landscape,
    format: 'Letter',
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
  });
  await browser.close();

  console.log(`✅ PDF: ${outPdf}`);
  console.log(`ℹ️  HTML preview: ${htmlOut}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
