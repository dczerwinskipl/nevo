﻿using NEvo.Messaging.Publish;

namespace NEvo.Messaging.Publishing;

public interface IMessagePublishStrategyFactory<in TMessageGroup> where TMessageGroup : IMessage
{
    IMessagePublishStrategy CreateFor(TMessageGroup message);
}
