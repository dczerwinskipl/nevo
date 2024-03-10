using LanguageExt;
using NEvo.Messaging.Handling;
using static LanguageExt.Prelude;

namespace NEvo.Messaging.CQRS.Events;

public class EventProcessingStrategy : IMessageProcessingStrategy
{
    private readonly IMessageHandlerRegistry _messageHandlerRegistry;

    public EventProcessingStrategy(IMessageHandlerRegistry messageHandlerRegistry)
    {
        _messageHandlerRegistry = messageHandlerRegistry;
    }

    public bool ShouldApply(IMessage message, IMessageContext context) => message is Event;

    public async Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var tasks = _messageHandlerRegistry.GetMessageHandlers(message).Select(async handler =>
        {
            // TODO: save result in case of any error? for retries
            using var scopedContext = context.CreateScope();
            return (await handler.HandleAsync(message, context.CreateScope(), cancellationToken)).Map(obj => (Unit)obj);
        });

        var results = await Task.WhenAll(tasks);
        var failures = results
            .Choose(either => either.Match(
                Left: ex => Some(ex),
                Right: _ => None
            ));

        return failures.Any() ? new AggregateException(failures) : Unit.Default;
    }
}
