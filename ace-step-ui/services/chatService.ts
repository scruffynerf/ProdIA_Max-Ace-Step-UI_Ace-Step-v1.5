import { sendChat, loadConfig, isConfigured, LLMMessage, saveChatHistory, loadChatHistory, StoredChatSession } from './llmProviderService';
import { uiBridge, UIState, formatUIStateForLLM, parseUIActions, UIAction } from './uiBridge';
// Import the knowledge base as raw text (bundled at build time)
import assistantKnowledge from '../data/assistant-knowledge.md?raw';

export interface ParsedMusicRequest {
  title?: string;
  style?: string;
  lyrics?: string;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  vocalLanguage?: string;
  instrumental?: boolean;
  duration?: number;
  inferenceSteps?: number;
  guidanceScale?: number;
  thinking?: boolean;
  enhance?: boolean;
  // Extended params (UIBridge era)
  shift?: number;
  inferMethod?: string;
  audioFormat?: string;
  taskType?: string;
  selectedModel?: string;
  lmModel?: string;
  seed?: number;
  randomSeed?: boolean;
  vocalGender?: string;
  loraScale?: number;
  loraEnabled?: boolean;
  editMode?: boolean;
  editAction?: string;
  editTarget?: string;
  variationMode?: boolean;
  audioInfluence?: number;
  styleInfluence?: number;
  weirdness?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'codes';
  content: string;
  timestamp: Date;
  parsedParams?: ParsedMusicRequest;
  isGenerating?: boolean;
  actions?: UIAction[];  // Actions parsed from LLM response
}

// ---------------------------------------------------------------------------
// SYSTEM PROMPT — ACE-Step 1.5 Expert
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_BASE = `Eres la asistente de producción musical de ProdIA Pro. Tienes CONTROL TOTAL sobre ACE-Step Studio — lees y modificas CUALQUIER parámetro en tiempo real. Eres una experta en producción musical y ACE-Step 1.5.

═══ PERSONALIDAD ═══
Productora profesional, directa y amigable. Hablas con naturalidad — concisa y clara. Puedes usar algún emoji puntual (🎵 ✨) pero sin abusar. NUNCA emojis en letras de canciones. Trata al usuario con respeto — usa "tú" de forma natural, sin apodos forzados (NUNCA "bestie", "compa", "crack", "máquina"). NO te presentes salvo que pregunten "¿quién eres?".

═══ REGLAS ═══
• IDIOMA: Responde según [LANG]. es=español, en=inglés, zh=mandarín.
• Cuando pidan crear/configurar/ajustar → ACTÚA con <ui_actions>. NO preguntes si puedes deducirlo.
• Si dicen "ajusta tú" → HAZLO directamente con tus mejores recomendaciones.
• Si hay LETRA → instrumental = false SIEMPRE. Solo true si lo piden EXPLÍCITAMENTE.
• Letras con saltos de línea. Un verso por línea. [Verse], [Chorus] en línea separada.
• ANTES de aplicar cambios, LISTA los cambios brevemente. Luego el bloque <ui_actions>.
• Después de aplicar, sugiere brevemente qué más se puede hacer.
• Sé CONCISA. Frases directas, informativas, profesionales.
• Si piden SOLO editar estilo/letra → cambia SOLO eso.

═══ FORMATO DE ACCIONES ═══
<ui_actions>
[{"inferenceSteps": 12, "guidanceScale": 7.5, "bpm": 95, "style": "reggaeton, dembow..."}]
</ui_actions>

Acciones especiales: {"action": "generate"} | {"action": "swapModel", "model": "..."} | {"action": "purgeVram"} | {"action": "loadLora", "name": "...", "variant": "..."} | {"action": "unloadLora"}

JSON alternativo (botón "Aplicar"):
\`\`\`json
{ "title": "...", "style": "...", "lyrics": "...", "bpm": 95, "instrumental": false }
\`\`\`

═══ FORMATO DE LETRAS ═══
SIEMPRE así:
[Verse]
Primer verso
Segundo verso

[Chorus]
Coro aquí

NUNCA todo junto en una línea.`;

// Agent mode addendum — AI applies actions autonomously
const AGENT_MODE_ADDENDUM = `

═══ MODO AGENTE (ACTIVO) ═══
Estás en MODO AGENTE. DEBES incluir <ui_actions> en CADA respuesta donde sugieras cambios. Tomas decisiones y las aplicas directamente. El usuario espera que actúes, no que solo expliques.`;

// Instructor mode addendum — AI only explains, no actions
const INSTRUCTOR_MODE_ADDENDUM = `

═══ MODO INSTRUCTOR (ACTIVO) ═══
Estás en MODO INSTRUCTOR. NO incluyas <ui_actions>. Solo EXPLICA qué haría el usuario para conseguir lo que pide — describe los parámetros, valores y pasos, pero NO apliques cambios. El usuario quiere aprender y hacerlo manualmente. Puedes usar formato JSON en bloques de código como referencia visual, pero no como acción ejecutable.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function chatWithAssistant(
  messages: ChatMessage[],
  lang: string = 'es',
  mode: 'agent' | 'instructor' = 'agent',
): Promise<{ reply: string; params?: ParsedMusicRequest; actions?: UIAction[] }> {
  if (!isConfigured()) {
    return mockChatResponse(messages);
  }

  try {
    // Build system prompt: base + mode addendum + knowledge base + UI state + language
    let systemPrompt = SYSTEM_PROMPT_BASE;
    systemPrompt += mode === 'agent' ? AGENT_MODE_ADDENDUM : INSTRUCTOR_MODE_ADDENDUM;
    systemPrompt += `\n\n═══ BASE DE CONOCIMIENTO ═══\n${assistantKnowledge}`;
    systemPrompt += `\n\n[LANG=${lang}] [MODE=${mode}]`;
    const uiState = uiBridge.getState();
    if (uiState) {
      systemPrompt += '\n\n' + formatUIStateForLLM(uiState);
    }

    // Convert ChatMessages to LLMMessages
    const llmMessages: LLMMessage[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await sendChat(llmMessages, systemPrompt);

    if (response.error) {
      const config = loadConfig();
      return {
        reply: `⚠️ Error from ${config.provider}: ${response.error}\n\nCheck your connection in Settings → AI Assistant.`,
      };
    }

    const rawReply = response.text || "I couldn't process that. Could you try again?";

    // Parse UI actions from the response
    const { cleanText: afterActions, actions } = parseUIActions(rawReply);

    // Extract JSON params from the reply (backward compat)
    const params = extractJsonParams(afterActions);

    // Clean the reply (remove JSON block)
    const cleanedReply = cleanReply(afterActions);

    return {
      reply: cleanedReply,
      params: params || undefined,
      actions: actions.length > 0 ? actions : undefined,
    };
  } catch (error: any) {
    console.error("Chat error:", error);
    return {
      reply: `⚠️ Error connecting to AI: ${error?.message || 'Unknown error'}. Check Settings → AI Assistant.`,
    };
  }
}

function extractJsonParams(text: string): ParsedMusicRequest | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    const params: ParsedMusicRequest = {};

    if (parsed.title) params.title = parsed.title;
    if (parsed.style) params.style = parsed.style;
    if (parsed.lyrics) params.lyrics = parsed.lyrics;
    if (parsed.bpm) params.bpm = Number(parsed.bpm);
    if (parsed.keyScale || parsed.key_scale || parsed.key) {
      params.keyScale = parsed.keyScale || parsed.key_scale || parsed.key;
    }
    if (parsed.timeSignature || parsed.time_signature) {
      params.timeSignature = parsed.timeSignature || parsed.time_signature;
    }
    if (parsed.vocalLanguage || parsed.vocal_language || parsed.language) {
      params.vocalLanguage = parsed.vocalLanguage || parsed.vocal_language || parsed.language;
    }
    if (parsed.instrumental !== undefined) params.instrumental = parsed.instrumental;
    if (parsed.duration) params.duration = Number(parsed.duration);
    if (parsed.inferenceSteps || parsed.inference_steps) {
      params.inferenceSteps = Number(parsed.inferenceSteps || parsed.inference_steps);
    }
    if (parsed.guidanceScale || parsed.guidance_scale) {
      params.guidanceScale = Number(parsed.guidanceScale || parsed.guidance_scale);
    }
    if (parsed.thinking !== undefined) params.thinking = parsed.thinking;
    if (parsed.enhance !== undefined) params.enhance = parsed.enhance;
    // Extended params
    if (parsed.shift) params.shift = Number(parsed.shift);
    if (parsed.inferMethod || parsed.infer_method) params.inferMethod = parsed.inferMethod || parsed.infer_method;
    if (parsed.audioFormat || parsed.audio_format) params.audioFormat = parsed.audioFormat || parsed.audio_format;
    if (parsed.taskType || parsed.task_type) params.taskType = parsed.taskType || parsed.task_type;
    if (parsed.selectedModel || parsed.model) params.selectedModel = parsed.selectedModel || parsed.model;
    if (parsed.lmModel || parsed.lm_model) params.lmModel = parsed.lmModel || parsed.lm_model;
    if (parsed.seed !== undefined) params.seed = Number(parsed.seed);
    if (parsed.randomSeed !== undefined) params.randomSeed = parsed.randomSeed;
    if (parsed.vocalGender || parsed.vocal_gender) params.vocalGender = parsed.vocalGender || parsed.vocal_gender;

    return Object.keys(params).length > 0 ? params : null;
  } catch {
    return null;
  }
}

function cleanReply(text: string): string {
  // Remove JSON block from visible reply
  return text.replace(/```json\s*[\s\S]*?\s*```/g, '').trim();
}

async function mockChatResponse(messages: ChatMessage[]): Promise<{ reply: string; params?: ParsedMusicRequest }> {
  const lastMsg = messages[messages.length - 1]?.content?.toLowerCase() || '';

  await new Promise(r => setTimeout(r, 800));

  if (lastMsg.includes('rock') || lastMsg.includes('guitar')) {
    return {
      reply: "🎸 Rock — buena elección. Te configuro guitarras eléctricas, batería contundente y voces potentes.\n\nEstilo: \"rock, electric guitar, driving drums, energetic, powerful vocals, distortion\"\n\nEstos tags te dan un sonido directo y con fuerza. ¿Generamos así o añadimos letra?",
      params: {
        style: "rock, electric guitar, driving drums, energetic, powerful vocals, distortion",
        bpm: 130,
        keyScale: "E minor",
        instrumental: false,
        duration: 180,
        inferenceSteps: 12,
      }
    };
  }

  if (lastMsg.includes('chill') || lastMsg.includes('relax') || lastMsg.includes('ambient')) {
    return {
      reply: "🌊 Ambiente relajado. Te preparo pads suaves y melodías etéreas.\n\nEstilo: \"ambient, chill, soft pads, ethereal, relaxing, atmospheric, downtempo\"\n\nLo pongo instrumental — funciona mejor sin voces para este mood. ¿Te parece o prefieres añadir alguna voz ambient?",
      params: {
        style: "ambient, chill, soft pads, ethereal, relaxing, atmospheric, downtempo",
        bpm: 75,
        keyScale: "C major",
        instrumental: true,
        duration: 240,
        inferenceSteps: 16,
      }
    };
  }

  if (lastMsg.includes('rap') || lastMsg.includes('hip hop') || lastMsg.includes('trap')) {
    return {
      reply: "🎤 Trap/Hip-hop. Te configuro 808s pesados y hi-hats crispy.\n\nEstilo: \"hip hop, trap, 808 bass, crispy hi-hats, dark, hard-hitting, rap\"\n\nSonido moderno y contundente. ¿Escribimos una letra o lo dejamos instrumental?",
      params: {
        style: "hip hop, trap, 808 bass, crispy hi-hats, dark, hard-hitting, rap",
        bpm: 140,
        keyScale: "G minor",
        instrumental: false,
        duration: 180,
        inferenceSteps: 12,
      }
    };
  }

  return {
    reply: "Hola, ¿qué necesitas?\n\nAlgunos ejemplos:\n• \"Hazme un reggaetón a 95 bpm\"\n• \"¿Qué diferencia hay entre modelo turbo y base?\"\n• \"Sube la calidad al máximo\"\n\n⚠️ No hay LLM configurado — modo básico. Ve a Settings → AI Assistant para conectar LM Studio, Ollama, Gemini o Claude.",
  };
}

export function formatParamsForDisplay(params: ParsedMusicRequest): string {
  const lines: string[] = [];
  if (params.title) lines.push(`🎵 Title: ${params.title}`);
  if (params.style) lines.push(`🎨 Style: ${params.style}`);
  if (params.bpm) lines.push(`⏱️ BPM: ${params.bpm}`);
  if (params.keyScale) lines.push(`🎹 Key: ${params.keyScale}`);
  if (params.timeSignature) lines.push(`📐 Time: ${params.timeSignature}/4`);
  if (params.vocalLanguage) lines.push(`🌍 Language: ${params.vocalLanguage}`);
  if (params.instrumental !== undefined) lines.push(`🎸 Instrumental: ${params.instrumental ? 'Yes' : 'No'}`);
  if (params.duration) lines.push(`⏳ Duration: ${params.duration}s`);
  if (params.inferenceSteps) lines.push(`🔧 Steps: ${params.inferenceSteps}`);
  if (params.guidanceScale) lines.push(`🎯 Guidance: ${params.guidanceScale}`);
  if (params.shift) lines.push(`📐 Shift: ${params.shift}`);
  if (params.inferMethod) lines.push(`🔀 Method: ${params.inferMethod}`);
  if (params.taskType) lines.push(`🎯 Task: ${params.taskType}`);
  if (params.selectedModel) lines.push(`🤖 Model: ${params.selectedModel}`);
  if (params.thinking !== undefined) lines.push(`💭 Thinking: ${params.thinking ? 'On' : 'Off'}`);
  if (params.enhance !== undefined) lines.push(`✨ Enhance: ${params.enhance ? 'On' : 'Off'}`);
  if (params.lyrics) lines.push(`📝 Lyrics: ${params.lyrics.substring(0, 100)}...`);
  return lines.join('\n');
}
