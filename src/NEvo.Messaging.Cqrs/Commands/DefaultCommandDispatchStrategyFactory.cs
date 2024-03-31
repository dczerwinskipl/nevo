using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Attributes;
using NEvo.Messaging.Dispatch;
using NEvo.Messaging.Dispatch.External;
using NEvo.Messaging.Dispatch.Internal;

namespace NEvo.Messaging.Cqrs.Commands;

public class DefaultCommandDispatchStrategyFactory(IServiceProvider serviceProvider, IEnumerable<IExternalMessageDispatchStrategy> externalMessageDispatchStrategies) : IMessageDispatchStrategyFactory<Command>
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

    private static bool IsPrivateMessage(Command message)
    {
        var customAttributes = message.GetType().GetCustomAttributes<MessageVisibilityAttribute>(true).ToList();
        return customAttributes.Count == 0 || customAttributes.All(v => v.IsPrivate);
    }
}
