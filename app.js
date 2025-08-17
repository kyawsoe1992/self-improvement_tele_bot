require('dotenv').config(); // ဒီစာကြောင်းကို File အစမှာ ထည့်ပါ
const TelegramBot = require('node-telegram-bot-api');
const supabase = require('@supabase/supabase-js');

// Config
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const sb = supabase.createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// User States & Challenges
const userStates = {};
const challenges = {
  reading: {
    title: "📖 30 မိနစ်စာဖတ်ပါ",
    questions: [
      "ဘာအုပ်ဖတ်တာလဲ?",
      "ဘာအကျိုးရှိလဲ?",
      "နက်ဖြန်ထပ်လုပ်မလား?"
    ]
  },
  exercise: {
    title: "💪 15 မိနစ်လေ့ကျင့်ခန်းလုပ်ပါ",
    questions: [
      "ဘယ်လေ့ကျင့်ခန်းလုပ်ခဲ့တာလဲ?",
      "ဘယ်လောက်ကြာခဲ့လဲ?",
      "မနက်ဖြန်အတွက်ရည်မှန်းချက်ရှိလား?"
    ]
  },
  video: {
    title: "🎥 2 မိနစ်ဗီဒီယိုသုံးသပ်ချက်ရိုက်ပါ",
    questions: [
      "ဒီနေ့ဘာတွေဖြစ်ခဲ့တာလဲ?",
      "ဘာသင်ခန်းစာရခဲ့လဲ?",
      "မနက်ဖြန်အတွက်ဘာတွေမျှော်လင့်ထားလဲ?"
    ]
  }
};

// ========================
// 🎯 Core Functions
// ========================
async function sendWelcome(userId) {
  await bot.sendMessage(userId, "🌟 မင်းကိုစောင့်နေတာ! ဒီ Bot နဲ့အတူတိုးတက်မှုခရီးစခန်းစတင်ကြမယ်!");
  await sendMotivation(userId);
  await showChallenges(userId);
}

async function sendMotivation(userId) {
  const quotes = ["ယနေ့ကိုအထူးဖြစ်အောင်နေပါ ❤️", "မင်းလုပ်နိုင်တယ်!"];
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  await bot.sendMessage(userId, `💌 မင်းအတွက်စိတ်ဓာတ်တက်ကြွစေမယ့်စာ:\n\n"${quote}"`);
}

async function showChallenges(userId) {
  const user = await getUser(userId);
  const remainingChallenges = Object.keys(challenges).filter(c => !user.completed_challenges?.includes(c));
  
  if (remainingChallenges.length === 0) {
    await bot.sendMessage(userId, "🎉 ဒီနေ့ Challenge အားလုံးပြီးပြီ! /dailysuccess ရိုက်ကြည့်နိုင်တယ်");
    return;
  }

  const buttons = remainingChallenges.map(c => ({
    text: challenges[c].title,
    callback_data: `start_${c}`
  }));

  await bot.sendMessage(userId, "🔻 ဒီနေ့လုပ်နိုင်တဲ့ Challenge တွေက:", {
    reply_markup: {
      inline_keyboard: [buttons]
    }
  });
}

// ========================
// 🤖 Bot Flow Handlers
// ========================
bot.onText(/\/start/, async (msg) => {
  const user = await getUser(msg.from.id);
  if (user.is_new) await sendWelcome(msg.from.id);
  else await showChallenges(msg.from.id);
});

bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;

  if (data.startsWith('start_')) {
    const challengeType = data.split('_')[1];
    await startChallenge(userId, challengeType);
  }
});

async function startChallenge(userId, challengeType) {
  // +1 Point for starting
  await sb.from('points').insert([{ user_id: userId, points: 1, challenge_type: challengeType }]);
  
  // Set reminder
  setTimeout(async () => {
    await bot.sendMessage(userId, `⏰ ${challenges[challengeType].title} ပြီးပြီလား?\n\n/done ရိုက်ပြီးဖြေကြားပါ`);
  }, 30 * 60 * 1000); // 30 minutes later

  await bot.sendMessage(userId, `✅ ${challenges[challengeType].title} Challenge စတင်ပြီး! (+1pt)\n\n30 မိနစ်ကြာတဲ့အခါ ငါပြန်မေးမယ်`);
}

// ========================
// 📝 Q&A Flow (Sequential)
// ========================
bot.onText(/\/done/, async (msg) => {
  const userId = msg.from.id;
  const user = await getUser(userId);
  
  if (!user.active_challenge) {
    const remaining = Object.keys(challenges).filter(c => !user.completed_challenges?.includes(c));
    if (remaining.length > 0) {
      await bot.sendMessage(userId, `⚠️ Challenge မစရသေးဘူး! ဒီထဲက တစ်ခုရွေးပါ:\n${remaining.map(c => challenges[c].title).join('\n')}`);
    }
    return;
  }

  userStates[userId] = {
    step: 0,
    challenge: user.active_challenge,
    answers: []
  };

  await askQuestion(userId);
});

async function askQuestion(userId) {
  const state = userStates[userId];
  const question = challenges[state.challenge].questions[state.step];
  
  await bot.sendMessage(userId, `❔ ${question}`);
}

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  
  const userId = msg.from.id;
  const state = userStates[userId];

  if (state && state.step !== undefined) {
    state.answers.push(msg.text);
    state.step++;

    if (state.step < challenges[state.challenge].questions.length) {
      await askQuestion(userId);
    } else {
      // All questions answered
      await completeChallenge(userId, state);
      delete userStates[userId];
    }
  }
});

async function completeChallenge(userId, state) {
  // +3 Points
  await sb.from('points').insert([
    { user_id: userId, points: 3, challenge_type: state.challenge }
  ]);

  // Mark as completed
  await sb.from('users').update({ 
    completed_challenges: sb.rpc('array_append', ['completed_challenges', state.challenge]),
    active_challenge: null
  }).eq('id', userId);

  await bot.sendMessage(userId, `🎉 ${challenges[state.challenge].title} အောင်မြင်ပြီး +3 Points ရပါပြီ!`);
  await showChallenges(userId); // Show remaining challenges
}

// ========================
// 📊 Daily Summary
// ========================
bot.onText(/\/dailysuccess/, async (msg) => {
  const userId = msg.from.id;
  const today = new Date().toISOString().split('T')[0];
  
  // Get today's completed challenges
  const { data: points } = await sb.from('points')
    .select('challenge_type, benefits')
    .eq('user_id', userId)
    .gte('created_at', today);

  let summary = "📅 ဒီနေ့ရဲ့အောင်မြင်မှုများ:\n\n";
  const uniqueChallenges = [...new Set(points.map(p => p.challenge_type))];
  
  uniqueChallenges.forEach(type => {
    const challenge = challenges[type];
    summary += `✅ ${challenge.title}\n`;
    summary += `   - အဖြေ: ${points.find(p => p.challenge_type === type)?.benefits || 'N/A'}\n\n`;
  });

  // Calculate total points
  const total = points.reduce((sum, p) => sum + p.points, 0);
  summary += `💰 စုစုပေါင်း Points: ${total}`;

  // Check weekly active bonus
  const { count } = await sb.from('points')
    .select('*', { count: 'exact' })
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  if (count >= 5) {
    await sb.from('points').insert([{ user_id: userId, points: 5, type: 'bonus' }]);
    summary += "\n\n🎁 Active Bonus +5 Points (တစ်ပတ်လုံးအသုံးပြုမှုအတွက်)";
  }

  await bot.sendMessage(userId, summary);
});

// ========================
// 🛠️ Helper Functions
// ========================
async function getUser(userId) {
  let { data: user } = await sb.from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (!user) {
    await sb.from('users').insert([{ 
      id: userId, 
      is_new: true,
      completed_challenges: [],
      active_challenge: null
    }]);
    return { id: userId, is_new: true };
  }
  return user;
}