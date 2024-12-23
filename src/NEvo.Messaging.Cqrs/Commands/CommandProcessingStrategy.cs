using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Strategies;
using static LanguageExt.Prelude;

namespace NEvo.Messaging.Cqrs.Commands;

public class CommandProcessingStrategy(
    IMessageHandlerRegistry messageHandlerRegistry,
    IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>> messageProcessingMiddleware
) : IMessageProcessingStrategy
{
    public CommandProcessingStrategy(
       IMessageHandlerRegistry messageHandlerRegistry,
       IEnumerable<MessageProcessingHandlerMiddlewareConfig> messageProcessingHandlerMiddlewares
    ) : this(
        messageHandlerRegistry,
        new MiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>(messageProcessingHandlerMiddlewares)
    )
    {
    }

    private readonly IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>> _messageProcessingMiddleware = Check.Null(messageProcessingMiddleware);

    public bool ShouldApply(IMessage message, IMessageContext context) => message is Command;

    public async Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        return await messageHandlerRegistry
            .GetMessageHandler(message)
            .MatchAsync(
                LeftAsync: async exception => await LeftAsync<Exception, Unit>(exception),
                RightAsync: async handler => await HandleAsync(handler, message, context, cancellationToken)
            );
    }

    protected async Task<Either<Exception, Unit>> HandleAsync(IMessageHandler handler, IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var result = await _messageProcessingMiddleware.ExecuteAsync(
            async (input, cancellationToken) => await handler.HandleAsync(message, context, cancellationToken),
            (handler, message, context),
            cancellationToken
        );

        return result.Map(obj => (Unit)obj);
    }
}
