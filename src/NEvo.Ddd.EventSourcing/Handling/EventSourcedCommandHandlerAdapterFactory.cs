using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Handling;

/// <summary>
/// Wires <see cref="IEventSourcedCommandHandler{TCommand,TAggregate,TId}"/> (Level 2)
/// into the standard <see cref="MessageHandlerExtractor"/> discovery pipeline, the same
/// way <c>CommandHandlerAdapterFactory</c> wires <c>ICommandHandler&lt;T&gt;</c>. A
/// concrete handler becomes discoverable by adding its type to
/// <see cref="MessageHandlerExtractorConfiguration"/>'s <c>Handlers</c> set (the same
/// mechanism every other handler kind already uses) — this factory is what lets the
/// extractor recognize <c>IEventSourcedCommandHandler&lt;,,&gt;</c> once it does.
/// Every produced description is tagged <see cref="HandlerRole.Primary"/> (D3) — an
/// explicit ES handler and an ordinary <c>ICommandHandler&lt;T&gt;</c> for the same
/// command are always a configuration error, never a silent preference.
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
            ReturnType: typeof(Unit),
            Role: HandlerRole.Primary
        );
    }

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription)
    {
        // InterfaceType carries the closed IEventSourcedCommandHandler<TCommand,
        // TAggregate,TId> this description was produced for — its own generic
        // arguments are exactly what EventSourcedCommandHandlerAdapter<,,> needs.
        var adapterType = typeof(EventSourcedCommandHandlerAdapter<,,>)
            .MakeGenericType(messageHandlerDescription.InterfaceType.GetGenericArguments());

        return (IMessageHandler)ActivatorUtilities.CreateInstance(_serviceProvider, adapterType, messageHandlerDescription);
    }
}
