const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const SYSTEM_PROMPT = `Você é um analista de logística especializado em operações PNR (Prova de Não Recebimento) da IHS.
Você analisa tickets de entrega, motoristas, rotas e métricas operacionais.

REGRAS:
- Responda SEMPRE em português brasileiro
- Use tabelas Markdown para comparações e listagens
- Destaque ofensores (motoristas com muitas reversões ou valores altos de PNR) em **negrito**
- Compare rotas e motoristas quando relevante
- Indique tendências e alertas operacionais
- Use emojis para indicadores: 🔴 crítico, 🟡 atenção, 🟢 bom
- Formate valores monetários como R$ X.XXX,XX
- Seja direto e objetivo nas análises
- Se não houver dados suficientes, informe claramente
- Quando mencionar motoristas problemáticos, liste suas rotas e valores

CONTEXTO DO SISTEMA:
- Tickets com status "ForBilling" = faturados (positivo)
- Tickets com status "Reversed" = revertidos (negativo/problema)
- PNR = Prova de Não Recebimento
- Cada ticket tem: ticketId, driver, station, pnrValue, status, cep, rejectionReason
- Motoristas podem ter rotas fixas atribuídas
- route_mapping mapeia CEPs para nomes de rotas`;

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

    const prompt = `${SYSTEM_PROMPT}\n\n--- DADOS ATUAIS DO SISTEMA ---\n${context || 'Sem dados disponíveis'}\n--- FIM DOS DADOS ---\n\nPERGUNTA DO USUÁRIO: ${query}`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const tableMatches = text.match(/\|.*\|/g);
    const resultsCount = tableMatches ? tableMatches.length : 1;

    res.json({ response: text, resultsCount });
  } catch (err) {
    console.error('Gemini API error:', err.message);
    res.status(500).json({ error: err.message || 'Erro interno do servidor.' });
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
