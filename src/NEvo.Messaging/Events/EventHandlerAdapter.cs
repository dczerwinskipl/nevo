using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.CQRS.Events;

public class EventHandlerAdapter : MessageHandlerAdapterBase<Event>
{
    public EventHandlerAdapter(MessageHandlerDescription messageHandlerDescription) : base(messageHandlerDescription)
    {
    }

    protected override async Task<Either<Exception, Unit>> InternalHandleAsync<TEvent>(TEvent @event, IMessageContext context, CancellationToken cancellationToken)
    {
        try
        {
            var handler = (IEventHandler<TEvent>)ActivatorUtilities.CreateInstance(context.ServiceProvider, HandlerDescription.HandlerType);
            return await handler.HandleAsync(@event, context, cancellationToken);
        }
        catch (Exception exc)
        {
            Console.WriteLine(exc.Message);
            return exc;
        }
    }
}
