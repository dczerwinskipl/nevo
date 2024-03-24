using NEvo.Messaging.Context;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Transporting;

[ExcludeFromCodeCoverage]
public record MessageEnvelope(IMessage Message, IMessageContextHeaders Headers);
