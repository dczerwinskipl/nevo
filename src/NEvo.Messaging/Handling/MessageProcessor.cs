using LanguageExt;
using NEvo.Core;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Handling;

public class MessageProcessingMiddlewareConfig : MiddlewareConfig<(IMessage message, IMessageContext), Either<Exception, object>, IMessageProcessingMiddleware>
{
    public MessageProcessingMiddlewareConfig(IMessageProcessingMiddleware middleware, Func<(IMessage message, IMessageContext), bool>? shouldApply = null) : base(middleware, shouldApply)
    {
    }
}

public class MessageProcessor : IMessageProcessor
{
    private readonly IMessageProcessingStrategyFactory _messageProcessingStrategyFactory;
    private readonly IMiddlewareHandler<(IMessage Message, IMessageContext MessageContext), Either<Exception, object>> _messageProcessingMiddleware;

    public MessageProcessor(
        IMessageProcessingStrategyFactory messageProcessingStrategyFactory,
        IEnumerable<MessageProcessingMiddlewareConfig> messageProcessingMiddlewares
    ) : this(
        messageProcessingStrategyFactory,
        new MiddlewareHandler<(IMessage message, IMessageContext), Either<Exception, object>, IMessageProcessingMiddleware>(messageProcessingMiddlewares)
    )
    {
    }

    public MessageProcessor(
        IMessageProcessingStrategyFactory messageProcessingStrategyFactory,
        IMiddlewareHandler<(IMessage message, IMessageContext), Either<Exception, object>> messageProcessingMiddleware
    )
    {
        _messageProcessingStrategyFactory = Check.Null(messageProcessingStrategyFactory);
        _messageProcessingMiddleware = Check.Null(messageProcessingMiddleware);
    }

    public async Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var strategy = _messageProcessingStrategyFactory.CreateForMessage(message, context);
        var result = await _messageProcessingMiddleware.ExecuteAsync(
            async (input, cancellationToken) => (await strategy.ProcessMessageAsync(message, context, cancellationToken)).Map(unit => (object)unit),
            (message, context),
            cancellationToken
        );
        return result.Map(o => (Unit)o);
    }

    public async Task<Either<Exception, TResult>> ProcessMessageAsync<TResult>(IMessage<TResult> message, IMessageContext context, CancellationToken cancellationToken)
    {
        var strategy = _messageProcessingStrategyFactory.CreateForMessageWithResult(message, context);
        var result = await _messageProcessingMiddleware.ExecuteAsync(
            async (input, cancellationToken) => await strategy.ProcessMessageWithResultAsync(message, context, cancellationToken),
            (message, context),
            cancellationToken
        );
        return result.Map(o => (TResult)o);
    }
}