export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const IMGBB_KEY = process.env.IMGBB_KEY;
  if (!IMGBB_KEY) {
    return res.status(500).json({ error: 'ImgBB key not configured on server' });
  }

  try {
    // Pipe the raw multipart FormData straight to ImgBB
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || '';

    const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    const data = await imgbbRes.json();
    return res.status(imgbbRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
