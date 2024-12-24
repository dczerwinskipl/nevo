using System.Diagnostics.CodeAnalysis;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Transporting;

[ExcludeFromCodeCoverage]
public record MessageEnvelopeDto(Guid MessageId, string MessageType, string Payload, MessageContextHeaders Headers, string? PartitionKey = null);
