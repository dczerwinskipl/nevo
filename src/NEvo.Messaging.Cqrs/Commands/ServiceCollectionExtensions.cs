using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Dispatch;
using NEvo.Messaging.Handling;

namespace Microsoft.Extensions.DependencyInjection;

public static partial class ServiceCollectionExtensions
{
    public static IServiceCollection AddCommands(this IServiceCollection services, bool useInternalCommandProcessing = false /* TODO: extend by CommandType*/)
    {
        services.AddSingleton<IMessageHandlerFactory, CommandHandlerAdapterFactory>();
        services.AddScoped<IMessageProcessingStrategy, CommandProcessingStrategy>();
        services.AddScoped<ICommandDispatcher, CommandDispatcher>();
        services.AddScoped<IMessageDispatchStrategyFactory<Command>, DefaultCommandDispatchStrategyFactory>();

        return services;
    }
}
