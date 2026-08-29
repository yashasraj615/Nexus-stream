export function displayTitle(name: string) {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[._]+/g, " ");
  const episode = base.match(/S\s*(\d{1,2})\s*E\s*(\d{1,3})/i);
  const cleaned = base
    .replace(/\bS\s*\d{1,2}\s*E\s*\d{1,3}\b/i, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(
      /\b(720p|1080p|2160p|4k|uhd|hdr10|hdr|bluray|blu-ray|web-?dl|web\s*dl|webrip|hdtv|remux|proper|repack|extended|unrated|multi|dual|aac(?:\s*\d(?:\.\d)?)?|ac3|dts|truehd|atmos|ddp|dd|h\s*264|h\s*265|x264|x265|hevc|avc|10bit|8bit)\b/gi,
      " ",
    )
    .replace(/\b[a-z0-9]{3,12}-\w+$/i, " ")
    .replace(/[\[\]()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (episode) {
    const code = `S${episode[1]!.padStart(2, "0")}E${episode[2]!.padStart(2, "0")}`;
    return cleaned ? `${code} · ${cleaned}` : code;
  }
  return cleaned || name;
}
