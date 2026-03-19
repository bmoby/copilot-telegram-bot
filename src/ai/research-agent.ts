import { askClaude } from './client.js';
import { buildContext } from './context-builder.js';
import { logger } from '../logger.js';

export interface ResearchResult {
  content: string;
}

const RESEARCH_PROMPT = `Tu es un agent de recherche expert, sans limites dans ta profondeur d'analyse.

SUJET :
{topic}

DETAILS :
{details}

{memory_context}

TA MISSION :
Produis un rapport de recherche COMPLET et APPROFONDI. Ne te retiens pas. Va au fond du sujet.

- Explore TOUS les angles possibles du sujet
- Fournis des donnees concretes, des chiffres, des statistiques recentes
- Analyse les tendances actuelles, les evolutions, les perspectives
- Cite des acteurs majeurs, des entreprises, des cas concrets
- Compare differentes approches, methodologies, solutions
- Identifie les risques, les opportunites, les points de vigilance
- Donne des recommandations actionables et argumentees
- N'hesite pas a aller en profondeur sur chaque sous-sujet
- Utilise toutes tes connaissances, y compris les plus recentes

FORMAT :
- Ecris en francais
- Utilise des titres clairs avec des emojis pour la lisibilite
- Paragraphes detailles, pas de bullet points generiques
- Chaque section doit etre substantielle (pas juste 2 lignes)
- Termine par des recommandations concretes et des sources
- Ecris autant que necessaire, ne te limite PAS en longueur

IMPORTANT : Reponds directement en texte structure. PAS de JSON. PAS de code. Juste le rapport.`;

export async function runResearchAgent(params: {
  topic: string;
  details: string;
  includeMemory?: boolean;
}): Promise<ResearchResult> {
  logger.info({ topic: params.topic }, 'Starting research agent');

  let memoryContext = '';
  if (params.includeMemory) {
    try {
      const context = await buildContext();
      memoryContext = `CONTEXTE PERSONNEL (utilise si pertinent pour enrichir la recherche) :\n${context}`;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'Failed to build context for research');
    }
  }

  const prompt = RESEARCH_PROMPT
    .replace('{topic}', params.topic)
    .replace('{details}', params.details || 'Aucun detail supplementaire. Explore le sujet librement.')
    .replace('{memory_context}', memoryContext);

  const response = await askClaude({
    prompt: `Fais une recherche approfondie et complete sur ce sujet. Ne te limite pas. Vas-y a fond.`,
    systemPrompt: prompt,
    model: 'sonnet',
    maxTokens: 16000,
  });

  logger.info(
    { topic: params.topic, responseLength: response.length },
    'Research agent completed'
  );

  return { content: response };
}
