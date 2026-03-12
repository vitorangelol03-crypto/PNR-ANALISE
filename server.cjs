const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const SYSTEM_PROMPT = `Você é um analista de logística PNR (Prova de Não Recebimento) da IHS. Responda SEMPRE em português brasileiro.

FORMATO OBRIGATÓRIO:
- Máximo 300 palavras
- Vá direto ao ponto, SEM introduções genéricas ("Vamos analisar...", "Com base nos dados...")
- Comece pela resposta/conclusão principal
- Tabelas Markdown com no máximo 10 linhas
- Use emojis de status: 🔴 crítico, 🟡 atenção, 🟢 bom
- Valores monetários: R$ X.XXX,XX
- Destaque ofensores em **negrito**
- Se não houver dados, diga "Sem dados disponíveis para esta análise."

CONTEXTO:
- "ForBilling" = faturado (positivo) | "Reversed" = revertido (problema)
- PNR = Prova de Não Recebimento
- Motoristas têm rotas fixas e vínculos com rotas`;

app.post('/api/gemini', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
    }

    const { query, context } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query é obrigatória.' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const prompt = `${SYSTEM_PROMPT}\n\n--- DADOS ---\n${context || 'Sem dados'}\n---\n\nPERGUNTA: ${query}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Gemini API error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Erro interno do servidor.' });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
