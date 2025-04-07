import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiProviderFactory } from './ai-provider.factory';
// Providers are instantiated within the factory, no need to list them here unless they need complex DI themselves
// import { DeepseekChatProvider } from './providers/deepseek-chat.provider';
// import { OpenRouterChatProvider } from './providers/openrouter-chat.provider';

@Global() // Make the factory easily injectable across the application
@Module({
  imports: [
    ConfigModule, // Factory needs ConfigService
    HttpModule, // Factory needs HttpService for OpenRouter provider
  ],
  providers: [
    AiProviderFactory,
    // If providers had complex dependencies, register them here:
    // DeepseekChatProvider,
    // OpenRouterChatProvider,
  ],
  exports: [AiProviderFactory], // Export the factory for other modules to use
})
export class AiProviderModule {}
