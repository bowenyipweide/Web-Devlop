const chatbot = require('../services/chatbot.service');

exports.chat = async (req, res) => {
  try {
    const { message, sessionId, action } = req.body || {};
    const hasAction = action && typeof action === 'object';
    if ((!message || typeof message !== 'string' || !message.trim()) && !hasAction) {
      return res.status(400).json({ success: false, message: 'A message is required.' });
    }
    const result = await chatbot.answer(message, { sessionId, user: req.user, action });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[chat] error:', err.message);
    res.status(500).json({
      success: false,
      reply: "I'm having trouble connecting to my knowledge base right now. Please try again in a moment.",
    });
  }
};

exports.refresh = async (req, res) => {
  try {
    chatbot.invalidateCache();
    await chatbot.buildIndex(true);
    res.json({ success: true, message: 'Chatbot index rebuilt.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};