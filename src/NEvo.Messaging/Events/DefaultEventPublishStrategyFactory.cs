using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Events.Attributes;
using NEvo.Messaging.Publish;
using NEvo.Messaging.Publishing;
using NEvo.Messaging.Publishing.External;
using NEvo.Messaging.Publishing.Internal;
using System.Reflection;

namespace NEvo.Messaging.Events;

public class DefaultEventPublishStrategyFactory(IServiceProvider serviceProvider) : IMessagePublishStrategyFactory<Event>
{
    public IMessagePublishStrategy CreateFor(Event message) =>
        CreateDedicatedServiceFor(message) ?? serviceProvider.GetRequiredService<IMessagePublishStrategy>();

    private IMessagePublishStrategy? CreateDedicatedServiceFor(Event message) => 
        IsPrivateMessage(message) ?
            serviceProvider.GetService<IInternalMessagePublishStrategy>() :
            serviceProvider.GetService<IExternalMessagePublishStrategy>();

    private static bool IsPrivateMessage(Event message)
    {
        var customAttributes = message.GetType().GetCustomAttributes<EventVisibilityAttribute>(true).ToList();
        return customAttributes.Count != 0 && !customAttributes.Exists(v => !v.IsPrivate);
    }
}
