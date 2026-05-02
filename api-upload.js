// api/upload.js — Vercel Serverless Function
// ImgBB API key is stored in Vercel Environment Variables (never exposed to browser)
// Set IMGBB_API_KEY in: Vercel Dashboard → Project → Settings → Environment Variables

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, name, expiration } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Build form data for ImgBB
    const formData = new URLSearchParams();
    formData.append('image', image);
    if (name)       formData.append('name',       name);
    if (expiration) formData.append('expiration', String(expiration));

    // Call ImgBB API server-side — key never exposed to browser
    const response = await fetch(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      {
        method: 'POST',
        body:   formData,
      }
    );

    const data = await response.json();

    if (!data.success) {
      return res.status(500).json({
        error:   'ImgBB upload failed',
        details: data
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({
      error:   'Server error',
      message: err.message
    });
  }
}
