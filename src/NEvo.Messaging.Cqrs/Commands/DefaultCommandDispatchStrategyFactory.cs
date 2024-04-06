using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using NEvo.Messaging.Attributes;
using NEvo.Messaging.Dispatch;
using NEvo.Messaging.Dispatch.External;
using NEvo.Messaging.Dispatch.Internal;
using System.Reflection;

namespace NEvo.Messaging.Cqrs.Commands;

public record CommandDispatchStrategyConfiguration
{
    public System.Collections.Generic.HashSet<Type> ExternalTypes { get; } = [];
}

public class DefaultCommandDispatchStrategyFactory(
    IServiceProvider serviceProvider,
    IEnumerable<IExternalMessageDispatchStrategy> externalMessageDispatchStrategies,
    IOptions<CommandDispatchStrategyConfiguration> options
) : IMessageDispatchStrategyFactory<Command>
{
    public IMessageDispatchStrategy CreateFor(Command message) =>
        CreateDedicatedServiceFor(message) ?? serviceProvider.GetRequiredService<IMessageDispatchStrategy>();

    private IMessageDispatchStrategy? CreateDedicatedServiceFor(Command message) =>
        IsPrivateMessage(message) ?
            serviceProvider.GetService<IInternalMessageDispatchStrategy>() :
            GetExternalMessageDispatchStrategy(message);

    private IExternalMessageDispatchStrategy? GetExternalMessageDispatchStrategy(Command command)
    {
        foreach (var strategy in externalMessageDispatchStrategies)
        {
            if (strategy.ShouldApply(command))
            {
                return strategy;
            }
        }
        return null;
    }

    // TODO change to: is External
    private bool IsPrivateMessage(Command message)
    {
        if (options.Value.ExternalTypes.Contains(message.GetType()))
            return false;

        var customAttributes = message.GetType().GetCustomAttributes<MessageVisibilityAttribute>(true).ToList();
        return customAttributes.Count == 0 || customAttributes.All(v => v.IsPrivate);
    }
}
