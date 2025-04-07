import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiChatProvider } from './ai-chat.provider.interface';
import { DeepseekChatProvider } from './providers/deepseek-chat.provider';
import { OpenRouterChatProvider } from './providers/openrouter-chat.provider';
// Import other providers like Gemini in the future

@Injectable()
export class AiProviderFactory {
  private readonly logger = new Logger(AiProviderFactory.name);
  private providers: Map<string, AiChatProvider> = new Map();

  constructor(
    private configService: ConfigService,
    // Inject HttpService because OpenRouter provider needs it
    private httpService: HttpService,
  ) {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Initialize DeepSeek Provider (if API key is configured)
    try {
      const deepseekProvider = new DeepseekChatProvider(this.configService);
      // Check if the internal client was actually initialized
      // This relies on the provider logging a warning if key is missing
      // A more robust check might involve an `isInitialized` method on the provider
      if (this.configService.get<string>('DEEPSEEK_API_KEY')) {
        this.providers.set('deepseek', deepseekProvider);
        this.logger.log('Registered DeepseekChatProvider.');
      }
    } catch (error) {
      this.logger.error('Failed to initialize DeepseekChatProvider:', error);
    }

    // Initialize OpenRouter Provider (if API key is configured)
    try {
      const openRouterProvider = new OpenRouterChatProvider(
        this.configService,
        this.httpService,
      );
      if (this.configService.get<string>('OPENROUTER_API_KEY')) {
        this.providers.set('openrouter', openRouterProvider);
        this.logger.log('Registered OpenRouterChatProvider.');
      }
    } catch (error) {
      this.logger.error('Failed to initialize OpenRouterChatProvider:', error);
    }

    // Initialize other providers here...
    // e.g., Gemini
  }

  /**
   * Gets the AI chat provider instance based on the name.
   * Defaults to 'openrouter' if no name is provided or the requested provider is not available.
   * @param providerName - The name of the provider (e.g., 'deepseek', 'openrouter'). Case-insensitive.
   * @returns The AiChatProvider instance or null if the default ('openrouter') is also unavailable.
   */
  public getProvider(providerName?: string): AiChatProvider | null {
    const name = providerName?.toLowerCase();
    let provider = name ? this.providers.get(name) : undefined;

    // If requested provider not found or not specified, try default 'openrouter'
    if (!provider) {
      this.logger.warn(
        `Provider "${name || 'none specified'}" not found or not initialized, attempting to use default 'openrouter'.`,
      );
      provider = this.providers.get('openrouter');
    }

    if (!provider) {
      this.logger.error(
        `Requested provider "${name || 'none specified'}" and default provider "openrouter" are not available.`,
      );
      return null; // Return null if neither requested nor default is available
    }

    return provider;
  }
}
