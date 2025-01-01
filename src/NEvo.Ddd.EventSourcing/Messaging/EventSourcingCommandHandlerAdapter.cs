using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Messaging;

public class EventSourcingCommandHandlerAdapter<TAggregate, TKey, TEventSourcedCommand, TEventSourcedEvent>(MessageHandlerDescription messageHandlerDescription) : MessageHandlerAdapterBase<Command>(messageHandlerDescription)
        where TAggregate : EventSourcedAggregate<TKey>
        where TEventSourcedCommand : EventSourcedCommand<TKey>
        where TEventSourcedEvent : EventSourcedEvent<TKey>
{
    protected override async Task<Either<Exception, Unit>> InternalHandleAsync<TCommand>(TCommand command, IMessageContext context, CancellationToken cancellationToken)
    {
        try
        {
            var handler = (ICommandHandler<TCommand>)ActivatorUtilities.CreateInstance(context.ServiceProvider, HandlerDescription.HandlerType);
            return await handler.HandleAsync(command, context, cancellationToken);
        }
        catch (Exception exc)
        {
            Console.WriteLine(exc.Message);
            return exc;
        }
    }
}
