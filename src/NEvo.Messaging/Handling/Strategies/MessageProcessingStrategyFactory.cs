using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Strategies;

public class MessageProcessingStrategyFactory(IEnumerable<IMessageProcessingStrategy> messageProcessingStrategies, IEnumerable<IMessageProcessingStrategyWithResult> messageProcessingStrategiesWithResult) : IMessageProcessingStrategyFactory
{
    public IMessageProcessingStrategy CreateForMessage(IMessage message, IMessageContext messageContext) => 
        messageProcessingStrategies.First(s => s.ShouldApply(message, messageContext));

    public IMessageProcessingStrategyWithResult CreateForMessageWithResult<TResult>(IMessage<TResult> message, IMessageContext messageContext) => 
        messageProcessingStrategiesWithResult.First(s => s.ShouldApply(message, messageContext));
}