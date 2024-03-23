using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Events;

public class EventHandlerAdapter(MessageHandlerDescription messageHandlerDescription, ILogger<EventHandlerAdapter> logger) : MessageHandlerAdapterBase<Event>(messageHandlerDescription)
{
    protected override async Task<Either<Exception, Unit>> InternalHandleAsync<TEvent>(TEvent @event, IMessageContext context, CancellationToken cancellationToken)
    {
        try
        {
            var handler = (IEventHandler<TEvent>)ActivatorUtilities.CreateInstance(context.ServiceProvider, HandlerDescription.HandlerType);
            return await handler.HandleAsync(@event, context, cancellationToken);
        }
        catch (Exception exc)
        {
            logger.LogError(exc, exc.Message);
            return exc;
        }
    }
}
