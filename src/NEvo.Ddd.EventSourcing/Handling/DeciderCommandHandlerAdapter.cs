using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Messaging;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Handling;

public class DeciderCommandHandlerAdapter<TCommand, TAggregate, TId>(
    IServiceProvider serviceProvider,
    ILogger<DeciderCommandHandlerAdapter<TCommand, TAggregate, TId>> logger,
    MessageHandlerDescription handlerDescription
) : IMessageHandler
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId, TAggregate>
    where TId : notnull
{
    private readonly IServiceProvider _serviceProvider = serviceProvider;
    private readonly ILogger<DeciderCommandHandlerAdapter<TCommand, TAggregate, TId>> _logger = logger;

    public MessageHandlerDescription HandlerDescription { get; } = handlerDescription;

    public async Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        try
        {
            var handler = ActivatorUtilities.CreateInstance<DeciderCommandHandler<TCommand, TAggregate, TId>>(context.ServiceProvider);
            return await handler.HandleAsync((TCommand)message, cancellationToken);
        }
        catch (Exception exc)
        {
            _logger.LogError(exc, "{Message}", exc.Message);
            return exc;
        }
    }
}
