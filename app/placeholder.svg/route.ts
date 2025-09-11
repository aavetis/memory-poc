export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const width = Number(searchParams.get("width")) || 512;
  const height = Number(searchParams.get("height")) || 512;

  const paddingStartX = width * 0.15;
  const paddingStartY = height * 0.15;
  const paddingEndX = width * 0.85;
  const paddingEndY = height * 0.85;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="fade1" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ccc" stop-opacity="0"/>
          <stop offset="50%" stop-color="#ccc" stop-opacity="1"/>
          <stop offset="100%" stop-color="#ccc" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="fade2" gradientUnits="objectBoundingBox" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stop-color="#ccc" stop-opacity="0"/>
          <stop offset="50%" stop-color="#ccc" stop-opacity="1"/>
          <stop offset="100%" stop-color="#ccc" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="#f4f4f4"/>
      <line x1="${paddingStartX}" y1="${paddingStartY}" x2="${paddingEndX}" y2="${paddingEndY}"
            stroke="url(#fade1)" stroke-width="2"/>
      <line x1="${paddingStartX}" y1="${paddingEndY}" x2="${paddingEndX}" y2="${paddingStartY}"
            stroke="url(#fade2)" stroke-width="2"/>
    </svg>
  `.trim();

  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml" },
  });
}
