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
