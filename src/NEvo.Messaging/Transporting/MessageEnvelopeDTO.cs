using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Transporting;

[ExcludeFromCodeCoverage]
public record MessageEnvelopeDto(Guid MessageId, string MessageType, string Payload, string Headers, string? PartitionKey = null);
