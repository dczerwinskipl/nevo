using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Handling;

/// <summary>
/// Makes an explicit <see cref="IEventSourcedCommandHandler{TCommand,TAggregate,TId}"/>
/// discoverable by <see cref="MessageHandlerExtractor"/>, the same way
/// <c>CommandHandlerAdapterFactory</c> makes an ordinary command handler discoverable. A
/// concrete handler type becomes discoverable by adding it to
/// <see cref="MessageHandlerExtractorConfiguration"/>'s <c>Handlers</c> set — the same
/// mechanism every handler kind uses. Every produced description is <see
/// cref="HandlerRole.Primary"/> by default: an explicit handler and an ordinary command
/// handler registered for the same command are always a configuration conflict, never a
/// silent preference.
/// </summary>
public class EventSourcedCommandHandlerAdapterFactory(IServiceProvider serviceProvider) : IMessageHandlerFactory
{
    private readonly IServiceProvider _serviceProvider = serviceProvider;

    public Type ForInterface => typeof(IEventSourcedCommandHandler<,,>);

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface)
    {
        var commandType = handlerInterface.GetGenericArguments()[0];
        yield return new MessageHandlerDescription(
            Key: $"{handlerType.FullName}-{commandType.FullName}",
            HandlerType: handlerType,
            MessageType: commandType,
            InterfaceType: handlerInterface,
            ReturnType: typeof(Unit)
        );
    }

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription)
    {
        if (messageHandlerDescription.InterfaceType is not { } handlerInterface)
        {
            throw new InvalidOperationException($"'{messageHandlerDescription.Key}' has no InterfaceType — {nameof(EventSourcedCommandHandlerAdapterFactory)} requires the closed IEventSourcedCommandHandler<,,> this description was produced for.");
        }

        var adapterType = typeof(EventSourcedCommandHandlerAdapter<,,>).MakeGenericType(handlerInterface.GetGenericArguments());
        return (IMessageHandler)ActivatorUtilities.CreateInstance(_serviceProvider, adapterType, messageHandlerDescription);
    }
}
