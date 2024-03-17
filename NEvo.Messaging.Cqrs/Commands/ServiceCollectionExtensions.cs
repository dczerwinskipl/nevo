using NEvo.Messaging;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Handling;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection UseCommands(this IServiceCollection services, bool useInternalCommandProcessing = false /* TODO: extend by CommandType*/)
    {
        services.AddSingleton<IMessageHandlerFactory, CommandHandlerAdapterFactory>();
        services.AddSingleton<IMessageProcessingStrategy, CommandProcessingStrategy>();
        services.AddSingleton<ICommandDispatcher, CommandDispatcher>();
        services.AddSingleton<IMessageDispatchStrategyFactory<Command>, DefaultCommandDispatchStrategyFactory>();

        return services;
    }
}
