using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Strategies;

public interface IMessageProcessingStrategyFactory
{
    IMessageProcessingStrategy CreateForMessage(IMessage message, IMessageContext messageContext);

    IMessageProcessingStrategyWithResult CreateForMessageWithResult<TResult>(IMessage<TResult> message, IMessageContext messageContext);
}
