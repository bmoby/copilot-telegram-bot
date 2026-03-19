import type { Bot, Context } from 'grammy';
import { transcribeAudio } from '../ai/transcribe.js';
import { processWithOrchestrator } from '../ai/orchestrator.js';
import { runResearchAgent } from '../ai/research-agent.js';
import { processMemoryRequest } from '../ai/memory-manager.js';
import { logger } from '../logger.js';
import { isAdmin } from '../utils/auth.js';
import { addMessage, formatHistoryForPrompt } from '../utils/conversation.js';
import { sendVoiceReply, sendLongMessage } from '../utils/reply.js';

export function registerVoiceHandler(bot: Bot): void {
  bot.on('message:voice', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    try {
      await ctx.reply('🎙️ J\'ecoute...');

      const voice = ctx.message?.voice;
      if (!voice) return;

      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env['TELEGRAM_BOT_TOKEN']}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      const text = await transcribeAudio(buffer, 'voice.ogg');

      if (!text || text.trim().length === 0) {
        await ctx.reply('Je n\'ai pas compris le message vocal. Essaie encore ?');
        return;
      }

      // Show transcription as text
      await ctx.reply(`📝 "${text}"`);

      const chatId = String(ctx.chat?.id);
      addMessage(chatId, 'user', text);
      const history = formatHistoryForPrompt(chatId);

      const result = await processWithOrchestrator(text, history);

      const memoryAction = result.actions.find((a) => a.type === 'manage_memory');

      if (memoryAction) {
        addMessage(chatId, 'assistant', result.response);
        // Voice reply for the orchestrator response
        await sendVoiceReply(ctx, result.response);

        try {
          const memoryResult = await processMemoryRequest({
            userMessage: text,
            conversationHistory: history,
          });
          // Memory details as text (structured data, not great for voice)
          await sendLongMessage(ctx, memoryResult.response);
          addMessage(chatId, 'assistant', memoryResult.response);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error({ err: errMsg }, 'Memory manager failed');
          await ctx.reply('Erreur lors de la modification memoire. Reessaie.');
        }
        return;
      }

      const researchAction = result.actions.find((a) => a.type === 'start_research');

      if (researchAction) {
        const topic = String(researchAction.data['topic'] ?? '');
        const details = String(researchAction.data['details'] ?? '');
        const includeMemory = Boolean(researchAction.data['include_memory']);

        addMessage(chatId, 'assistant', result.response);
        await sendVoiceReply(ctx, result.response);

        try {
          const research = await runResearchAgent({ topic, details, includeMemory });
          // Research reports are long — send as text
          await sendLongMessage(ctx, research.content);
          addMessage(chatId, 'assistant', `Recherche envoyee : ${topic}`);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error({ err: errMsg, topic }, 'Research agent failed');
          await ctx.reply(`Erreur lors de la recherche : ${errMsg}\nEssaie de reformuler ou redemande.`);
        }
        return;
      }

      // Normal flow — voice response
      addMessage(chatId, 'assistant', result.response);
      await sendVoiceReply(ctx, result.response);

    } catch (error) {
      logger.error({ error }, 'Failed to process voice message');
      await ctx.reply('Erreur lors du traitement du vocal. Essaie en texte ou renvoie le vocal.');
    }
  });
}
