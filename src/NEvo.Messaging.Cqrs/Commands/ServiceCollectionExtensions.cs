using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Dispatching;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Strategies;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddCommands(this IServiceCollection services)
    {
        services.AddSingleton<IMessageHandlerFactory, CommandHandlerAdapterFactory>();
        services.AddScoped<IMessageProcessingStrategy, CommandProcessingStrategy>();
        services.AddScoped<ICommandDispatcher, CommandDispatcher>();
        services.AddScoped<IMessageDispatchStrategyFactory<Command>, DefaultCommandDispatchStrategyFactory>();

        return services;
    }
}
