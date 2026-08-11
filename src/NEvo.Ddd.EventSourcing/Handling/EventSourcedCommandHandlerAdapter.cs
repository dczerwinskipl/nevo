using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Messaging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Handling;

/// <summary>
/// Adapts a Level 2 <see cref="IEventSourcedCommandHandler{TCommand,TAggregate,TId}"/>
/// into an <see cref="IMessageHandler"/>, routing it through the same
/// <see cref="IEventSourcedCommandExecutor"/> Level 1's
/// <see cref="DeciderCommandHandlerAdapter{TCommand,TAggregate,TId}"/> uses — no
/// load/append/publish logic is duplicated between the two adapters. Registration/
/// discovery (making this the effective handler for a command type) is task 05's
/// concern, not this type's.
/// </summary>
public class EventSourcedCommandHandlerAdapter<TCommand, TAggregate, TId>(
    ILogger<EventSourcedCommandHandlerAdapter<TCommand, TAggregate, TId>> logger,
    MessageHandlerDescription handlerDescription
) : IMessageHandler
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    private readonly ILogger<EventSourcedCommandHandlerAdapter<TCommand, TAggregate, TId>> _logger = logger;

    public MessageHandlerDescription HandlerDescription { get; } = handlerDescription;

    public async Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        try
        {
            var command = (TCommand)message;
            var handler = context.ServiceProvider.GetRequiredService<IEventSourcedCommandHandler<TCommand, TAggregate, TId>>();
            var executor = context.ServiceProvider.GetRequiredService<IEventSourcedCommandExecutor>();
            var authorization = context.ServiceProvider.GetRequiredService<IAggregateAuthorization<TCommand, TAggregate, TId>>();

            var result = await executor.ExecuteAsync<TCommand, TAggregate, TId>(
                command,
                context,
                authorization,
                state => handler.HandleAsync(command, state, cancellationToken),
                cancellationToken
            );

            return result.Map(unit => (object)unit);
        }
        catch (Exception exc)
        {
            _logger.LogError(exc, "{Message}", exc.Message);
            return exc;
        }
    }
}
