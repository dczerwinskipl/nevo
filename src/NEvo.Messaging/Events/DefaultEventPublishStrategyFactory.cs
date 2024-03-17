using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Cqrs.Events;
using NEvo.Messaging.Events.Attributes;
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

    // TODO: extend it as dependency
    //       can be used like: Attribute, Convention (visiblity, naming), direct configuration
    private static bool IsPrivateMessage(Event message)
    {
        var customAttributes = message.GetType().GetCustomAttributes<EventVisibilityAttribute>(true).ToList();
        return customAttributes.Count != 0 && !customAttributes.Any(v => !v.IsPrivate);
    }
}
