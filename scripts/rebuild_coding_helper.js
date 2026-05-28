const fs = require('fs');

const src = '/home/codespace/.vscode-remote/data/User/workspaceStorage/-52c4e617/GitHub.copilot-chat/transcripts/0dc0d31d-c7c8-41a3-ac16-71b003f04b54.jsonl';
const out = '/workspaces/THERASSISTANTREPLIT/artifacts/therassistant-ehr/public/clinical-coding-tool.html';

const lines = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean);
let content = '';

for (let i = lines.length - 1; i >= 0; i -= 1) {
  try {
    const row = JSON.parse(lines[i]);
    if (
      row.type === 'user.message' &&
      row.data &&
      typeof row.data.content === 'string' &&
      row.data.content.includes('<!DOCTYPE html>')
    ) {
      content = row.data.content;
      break;
    }
  } catch {
    // ignore malformed lines
  }
}

if (!content) throw new Error('HTML payload not found in transcript');

const start = content.indexOf('<!DOCTYPE html>');
const end = content.lastIndexOf('</html>');
if (start < 0 || end < 0) throw new Error('Could not delimit HTML payload');

let html = content.slice(start, end + '</html>'.length);

html = html
  .replace(/<link rel="stylesheet" href="style\.css">\n?/g, '')
  .replace(/<script src="shared\.js\?v=2"><\/script>\n?/g, '')
  .replace(/<script src="signal-library\.js\?v=1"><\/script>\n?/g, '')
  .replace(/<script src="sidebar\.js\?v=2"><\/script>\n?/g, '')
  .replace(/<script src="chat-widget\.js\?v=1"><\/script>\n?/g, '');

const shims = [
  '<script>',
  'function getStoredCoderReports(){',
  "  try { return JSON.parse(localStorage.getItem('docusistant_saved_reports') || '[]'); } catch { return []; }",
  '}',
  'function setStoredCoderReports(reports){',
  "  localStorage.setItem('docusistant_saved_reports', JSON.stringify(reports));",
  '}',
  'const CLINICIAN_ROLES = [];',
  '</script>',
  ''
].join('\n');

html = html.replace('</head>', shims + '</head>');

fs.writeFileSync(out, html, 'utf8');
console.log('rebuilt', out, 'bytes', Buffer.byteLength(html));
