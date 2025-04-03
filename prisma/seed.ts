import { PrismaClient } from '@prisma/client';

// 初始化 Prisma Client
const prisma = new PrismaClient();

async function main() {
  console.log(`开始填充数据...`);

  // --- 1. 创建 TTS 声音选项 ---
  const voice1 = await prisma.voice.upsert({
    where: { name: 'Alloy' },
    update: {},
    create: {
      name: 'Alloy',
      provider: 'OpenAI',
      language: 'en', // 假设 Alloy 主要用于英文
      description: 'OpenAI standard voice',
    },
  });

  const voice2 = await prisma.voice.upsert({
    where: { name: 'Echo' },
    update: {},
    create: {
      name: 'Echo',
      provider: 'OpenAI',
      language: 'en',
      description: 'OpenAI standard voice',
    },
  });
  console.log(`创建了 TTS 声音: ${voice1.name}, ${voice2.name}`);

  // --- 2. 创建 AI 模型选项 (为未来准备) ---
  const model1 = await prisma.aIModel.upsert({
    where: { name: 'GPT-4' },
    update: {},
    create: {
      name: 'GPT-4',
      provider: 'OpenAI',
      description: 'Powerful model from OpenAI',
    },
  });
  const model2 = await prisma.aIModel.upsert({
    where: { name: 'Claude 3 Sonnet' },
    update: {},
    create: {
      name: 'Claude 3 Sonnet',
      provider: 'Anthropic',
      description: 'Balanced model from Anthropic',
    },
  });
  console.log(`创建了 AI 模型: ${model1.name}, ${model2.name}`);

  // --- 3. 创建测试用户 ---
  const testUser = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      // 可以添加 googleId 等用于测试登录
    },
  });
  console.log(`创建了测试用户: ${testUser.email}`);

  // --- 4. 创建用户设置，并关联偏好声音 ---
  const userSettings = await prisma.userSettings.upsert({
    where: { userId: testUser.id },
    update: {},
    create: {
      userId: testUser.id,
      preferredVoiceId: voice1.id, // 默认偏好 Alloy
      // preferredAiModelId: model1.id, // 可以设置默认 AI 模型
      enableNotifications: true,
    },
  });
  console.log(`为用户 ${testUser.email} 创建了设置，偏好声音: ${voice1.name}`);

  // --- 5. 创建基础单词 ---
  const wordHello = await prisma.word.upsert({
    where: { text_language: { text: 'hello', language: 'en' } },
    update: {},
    create: { text: 'hello', language: 'en' },
  });
  const wordWorld = await prisma.word.upsert({
    where: { text_language: { text: 'world', language: 'en' } },
    update: {},
    create: { text: 'world', language: 'en' },
  });
  const wordPrisma = await prisma.word.upsert({
    where: { text_language: { text: 'prisma', language: 'en' } },
    update: {},
    create: { text: 'prisma', language: 'en' },
  });
  console.log(
    `创建了基础单词: ${wordHello.text}, ${wordWorld.text}, ${wordPrisma.text}`,
  );

  // --- 6. 为测试用户添加单词学习记录 ---
  const userWordHello = await prisma.userWord.upsert({
    where: { userId_wordId: { userId: testUser.id, wordId: wordHello.id } },
    update: {},
    create: {
      userId: testUser.id,
      wordId: wordHello.id,
      context: 'A common greeting is "hello".',
      translation: '你好',
      familiarity: 1, // 假设刚学
      nextReviewDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 天后复习
    },
  });
  const userWordWorld = await prisma.userWord.upsert({
    where: { userId_wordId: { userId: testUser.id, wordId: wordWorld.id } },
    update: {},
    create: {
      userId: testUser.id,
      wordId: wordWorld.id,
      context: 'Hello world is often the first program.',
      translation: '世界',
      familiarity: 0,
      nextReviewDate: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 小时后复习
    },
  });
  console.log(
    `为用户 ${testUser.email} 添加了单词学习记录: ${wordHello.text}, ${wordWorld.text}`,
  );

  // --- 7. 创建标签 ---
  const tagGreeting = await prisma.tag.upsert({
    where: { userId_name: { userId: testUser.id, name: 'Greeting' } },
    update: {},
    create: { userId: testUser.id, name: 'Greeting' },
  });
  const tagProgramming = await prisma.tag.upsert({
    where: { userId_name: { userId: testUser.id, name: 'Programming' } },
    update: {},
    create: { userId: testUser.id, name: 'Programming' },
  });
  console.log(
    `为用户 ${testUser.email} 创建了标签: ${tagGreeting.name}, ${tagProgramming.name}`,
  );

  // --- 8. 将标签关联到用户单词 ---
  await prisma.userWordTag.upsert({
    where: {
      userWordId_tagId: { userWordId: userWordHello.id, tagId: tagGreeting.id },
    },
    update: {},
    create: { userWordId: userWordHello.id, tagId: tagGreeting.id },
  });
  await prisma.userWordTag.upsert({
    where: {
      userWordId_tagId: {
        userWordId: userWordWorld.id,
        tagId: tagProgramming.id,
      },
    },
    update: {},
    create: { userWordId: userWordWorld.id, tagId: tagProgramming.id },
  });
  console.log(
    `将标签关联到单词: ${wordHello.text} -> ${tagGreeting.name}, ${wordWorld.text} -> ${tagProgramming.name}`,
  );

  console.log(`数据填充完成。`);
}

main()
  .catch(async (e) => {
    console.error('填充数据时出错:', e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    // 关闭 Prisma Client 连接
    await prisma.$disconnect();
  });
