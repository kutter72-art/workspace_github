require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { callGemini } = require('./geminiClient');
const { callGpt } = require('./gptClient');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.post('/verify', async function (req, res) {
    const slides = req.body && req.body.slides;
    if (!Array.isArray(slides) || slides.length === 0) {
      return res.status(400).json({ error: 'slides 배열이 비어 있습니다' });
    }

    const [geminiResult, gptResult] = await Promise.allSettled([
      callGemini(slides, process.env.GEMINI_API_KEY),
      callGpt(slides, process.env.OPENAI_API_KEY)
    ]);

    res.json({
      gemini: geminiResult.status === 'fulfilled' ? geminiResult.value : { error: geminiResult.reason.message },
      gpt: gptResult.status === 'fulfilled' ? gptResult.value : { error: gptResult.reason.message }
    });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3001;
  app.listen(port, function () {
    console.log('검증 서버 실행 중: http://localhost:' + port);
    if (!process.env.GEMINI_API_KEY) console.warn('경고: GEMINI_API_KEY가 설정되지 않았습니다');
    if (!process.env.OPENAI_API_KEY) console.warn('경고: OPENAI_API_KEY가 설정되지 않았습니다');
  });
}

module.exports = { createApp };
