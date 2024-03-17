using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Handling;
using static LanguageExt.Prelude;

namespace NEvo.Messaging.Cqrs.Events;

public class EventProcessingStrategy(IMessageHandlerRegistry messageHandlerRegistry) : IMessageProcessingStrategy
{
    public bool ShouldApply(IMessage message, IMessageContext context) => message is Event;

    public async Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var tasks = messageHandlerRegistry.GetMessageHandlers(message).Select(handler => HandleAsync(handler, message, context, cancellationToken));
        var results = await Task.WhenAll(tasks);
        var failures = results
            .Choose(either => either.Match(
                Left: ex => Some(ex),
                Right: _ => None
            ));

        return failures.Any() ? new AggregateException(failures) : Unit.Default;
    }

    private static async Task<Either<Exception, Unit>> HandleAsync(IMessageHandler handler, IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        using var scopedContext = context.CreateScope();

        // TODO: maybe it's better to use here middleware?
        var inbox = scopedContext.ServiceProvider.GetService<IMessageInbox>();
        if (inbox != null && inbox.IsAlreadyProcessed(handler, message, context))
        {
            return Unit.Default;
        }

        var result = (await handler.HandleAsync(message, context.CreateScope(), cancellationToken)).Map(obj => (Unit)obj);

        inbox?.RegisterProcessed(handler, message, context);

        return result;
    }
}
