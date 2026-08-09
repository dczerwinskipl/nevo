using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Strategies;
using static LanguageExt.Prelude;

namespace NEvo.Messaging.Cqrs.Queries;

public class QueryProcessingStrategy(
    IMessageHandlerRegistry messageHandlerRegistry,
    IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>> messageProcessingMiddleware
) : IMessageProcessingStrategyWithResult
{
    public QueryProcessingStrategy(
       IMessageHandlerRegistry messageHandlerRegistry,
       IEnumerable<MessageProcessingHandlerMiddlewareConfig> messageProcessingHandlerMiddlewares
    ) : this(
        messageHandlerRegistry,
        new MiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>(messageProcessingHandlerMiddlewares)
    )
    {
    }

    private readonly IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>> _messageProcessingMiddleware = Check.Null(messageProcessingMiddleware);

    public bool ShouldApply<TResult>(IMessage<TResult> message, IMessageContext context) => message is Query<TResult>;

    public async Task<Either<Exception, TResult>> ProcessMessageWithResultAsync<TResult>(IMessage<TResult> message, IMessageContext context, CancellationToken cancellationToken)
    {
        return await messageHandlerRegistry
            .GetMessageHandler(message)
            .MatchAsync(
                LeftAsync: async exception => await LeftAsync<Exception, TResult>(exception),
                RightAsync: async handler => await HandleAsync<TResult>(handler, message, context, cancellationToken)
            );
    }

    protected async Task<Either<Exception, TResult>> HandleAsync<TResult>(IMessageHandler handler, IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var result = await _messageProcessingMiddleware.ExecuteAsync(
            async (input, cancellationToken) => await handler.HandleAsync(message, context, cancellationToken),
            (handler, message, context),
            cancellationToken
        );

        return result.Map(obj => (TResult)obj);
    }
}
