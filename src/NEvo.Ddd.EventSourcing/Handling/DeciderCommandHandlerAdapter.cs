using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Messaging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Handling;

public class DeciderCommandHandlerAdapter<TCommand, TAggregate, TId>(
    ILogger<DeciderCommandHandlerAdapter<TCommand, TAggregate, TId>> logger,
    MessageHandlerDescription handlerDescription
) : IMessageHandler
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    private readonly ILogger<DeciderCommandHandlerAdapter<TCommand, TAggregate, TId>> _logger = logger;

    public MessageHandlerDescription HandlerDescription { get; } = handlerDescription;

    public async Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        try
        {
            var handler = ActivatorUtilities.CreateInstance<DeciderCommandHandler<TCommand, TAggregate, TId>>(context.ServiceProvider);
            var result = await handler.HandleAsync((TCommand)message, cancellationToken);
            return result.Map(unit => (object)unit);
        }
        catch (Exception exc)
        {
            _logger.LogError(exc, "{Message}", exc.Message);
            return exc;
        }
    }
}
