using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling.Middleware;

namespace NEvo.Messaging.Handling;

public class MessageProcessingMiddlewareConfig : MiddlewareConfig<(IMessage message, IMessageContext), Either<Exception, object>>
{
    public MessageProcessingMiddlewareConfig(IMessageProcessingMiddleware middleware, Func<(IMessage message, IMessageContext), bool>? shouldApply = null) : base(middleware, shouldApply)
    {
    }
}
