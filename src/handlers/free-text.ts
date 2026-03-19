import type { Bot, Context } from 'grammy';
import { processWithOrchestrator } from '../ai/orchestrator.js';
import { runResearchAgent } from '../ai/research-agent.js';
import { processMemoryRequest } from '../ai/memory-manager.js';
import { isOnboarding, processOnboardingResponse } from '../ai/onboarding.js';
import { logger } from '../logger.js';
import { isAdmin } from '../utils/auth.js';
import { addMessage, formatHistoryForPrompt } from '../utils/conversation.js';
import { sendLongMessage, smartReply } from '../utils/reply.js';

export function registerFreeText(bot: Bot): void {
  bot.on('message:text', async (ctx: Context) => {
    if (!isAdmin(ctx)) return;

    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return;

    const chatId = String(ctx.chat?.id);

    // Handle onboarding flow
    if (isOnboarding(chatId)) {
      try {
        const result = await processOnboardingResponse(chatId, text);
        await ctx.reply(result.reply);
      } catch (error) {
        logger.error({ error }, 'Onboarding response failed');
        await ctx.reply('Erreur pendant l\'onboarding. Renvoie ton message.');
      }
      return;
    }

    try {
      addMessage(chatId, 'user', text);
      const history = formatHistoryForPrompt(chatId);

      const result = await processWithOrchestrator(text, history);

      // Check if memory management was triggered
      const memoryAction = result.actions.find((a) => a.type === 'manage_memory');

      if (memoryAction) {
        addMessage(chatId, 'assistant', result.response);
        await smartReply(ctx, result.response);

        try {
          const memoryResult = await processMemoryRequest({
            userMessage: text,
            conversationHistory: history,
          });
          await sendLongMessage(ctx, memoryResult.response);
          addMessage(chatId, 'assistant', memoryResult.response);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error({ err: errMsg }, 'Memory manager failed');
          await ctx.reply('Erreur lors de la modification memoire. Reessaie.');
        }
        return;
      }

      // Check if a research was triggered
      const researchAction = result.actions.find((a) => a.type === 'start_research');

      if (researchAction) {
        const topic = String(researchAction.data['topic'] ?? '');
        const details = String(researchAction.data['details'] ?? '');
        const includeMemory = Boolean(researchAction.data['include_memory']);

        addMessage(chatId, 'assistant', result.response);
        await smartReply(ctx, result.response);

        try {
          const research = await runResearchAgent({ topic, details, includeMemory });
          await sendLongMessage(ctx, research.content);
          addMessage(chatId, 'assistant', `Recherche envoyee : ${topic}`);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error({ err: errMsg, topic }, 'Research agent failed');
          await ctx.reply(`Erreur lors de la recherche : ${errMsg}\nEssaie de reformuler ou redemande.`);
        }
        return;
      }

      // Normal flow
      addMessage(chatId, 'assistant', result.response);
      await smartReply(ctx, result.response);
    } catch (error) {
      logger.error({ error, text }, 'Failed to process free text');
      await ctx.reply('Erreur de traitement. Renvoie ton message.');
    }
  });
}
