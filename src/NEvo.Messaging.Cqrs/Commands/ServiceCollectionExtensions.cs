using Microsoft.Extensions.DependencyInjection.Extensions;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Dispatching;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Strategies;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddCommands(this IServiceCollection services)
    {
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IMessageHandlerFactory, CommandHandlerAdapterFactory>());
        services.TryAddEnumerable(ServiceDescriptor.Scoped<IMessageProcessingStrategy, CommandProcessingStrategy>());
        services.TryAddScoped<ICommandDispatcher, CommandDispatcher>();
        services.TryAddScoped<IMessageDispatchStrategyFactory<Command>, DefaultCommandDispatchStrategyFactory>();

        return services;
    }
}
