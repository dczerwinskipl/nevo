﻿using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Strategies;

namespace NEvo.Messaging.Handling;

public class MessageProcessor(
    IMessageProcessingStrategyFactory messageProcessingStrategyFactory,
    IMiddlewareHandler<(IMessage message, IMessageContext), Either<Exception, object>> messageProcessingMiddleware
    ) : IMessageProcessor
{
    private readonly IMessageProcessingStrategyFactory _messageProcessingStrategyFactory = Check.Null(messageProcessingStrategyFactory);
    private readonly IMiddlewareHandler<(IMessage Message, IMessageContext MessageContext), Either<Exception, object>> _messageProcessingMiddleware = Check.Null(messageProcessingMiddleware);

    public MessageProcessor(
        IMessageProcessingStrategyFactory messageProcessingStrategyFactory,
        IEnumerable<MessageProcessingMiddlewareConfig> messageProcessingMiddlewares
    ) : this(
        messageProcessingStrategyFactory,
        new MiddlewareHandler<(IMessage message, IMessageContext), Either<Exception, object>>(messageProcessingMiddlewares)
    )
    {
    }

    public async Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var result = await _messageProcessingMiddleware.ExecuteAsync(
            async (input, cancellationToken) => (await _messageProcessingStrategyFactory
                                                            .CreateForMessage(message, context)
                                                            .ProcessMessageAsync(message, context, cancellationToken))
                                                            .Map(unit => (object)unit),
            (message, context),
            cancellationToken
        );
        return result.Map(o => (Unit)o);
    }

    public async Task<Either<Exception, TResult>> ProcessMessageAsync<TResult>(IMessage<TResult> message, IMessageContext context, CancellationToken cancellationToken)
    {
        var result = await _messageProcessingMiddleware.ExecuteAsync(
            async (input, cancellationToken) => await _messageProcessingStrategyFactory
                                                            .CreateForMessageWithResult(message, context)
                                                            .ProcessMessageWithResultAsync(message, context, cancellationToken),
            (message, context),
            cancellationToken
        );
        return result.Map(o => (TResult)o);
    }
}