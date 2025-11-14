pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedLoyaltyExchange is ZamaEthereumConfig {
    struct LoyaltyProgram {
        string programId;
        euint32 encryptedBalance;
        uint256 publicConversionRate;
        address programOwner;
        uint32 decryptedBalance;
        bool isVerified;
    }

    mapping(string => LoyaltyProgram) public loyaltyPrograms;
    string[] public programIds;

    event ProgramRegistered(string indexed programId, address indexed owner);
    event BalanceVerified(string indexed programId, uint32 decryptedBalance);
    event PointsExchanged(string indexed fromProgram, string indexed toProgram, uint256 amount);

    constructor() ZamaEthereumConfig() {}

    function registerProgram(
        string calldata programId,
        externalEuint32 encryptedBalance,
        bytes calldata inputProof,
        uint256 publicConversionRate
    ) external {
        require(bytes(loyaltyPrograms[programId].programId).length == 0, "Program already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedBalance, inputProof)), "Invalid encrypted input");

        loyaltyPrograms[programId] = LoyaltyProgram({
            programId: programId,
            encryptedBalance: FHE.fromExternal(encryptedBalance, inputProof),
            publicConversionRate: publicConversionRate,
            programOwner: msg.sender,
            decryptedBalance: 0,
            isVerified: false
        });

        FHE.allowThis(loyaltyPrograms[programId].encryptedBalance);
        FHE.makePubliclyDecryptable(loyaltyPrograms[programId].encryptedBalance);
        programIds.push(programId);

        emit ProgramRegistered(programId, msg.sender);
    }

    function verifyBalance(
        string calldata programId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(loyaltyPrograms[programId].programId).length > 0, "Program does not exist");
        require(!loyaltyPrograms[programId].isVerified, "Balance already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(loyaltyPrograms[programId].encryptedBalance);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        loyaltyPrograms[programId].decryptedBalance = decodedValue;
        loyaltyPrograms[programId].isVerified = true;

        emit BalanceVerified(programId, decodedValue);
    }

    function exchangePoints(
        string calldata fromProgramId,
        string calldata toProgramId,
        euint32 encryptedAmount,
        bytes calldata inputProof
    ) external {
        require(bytes(loyaltyPrograms[fromProgramId].programId).length > 0, "Source program does not exist");
        require(bytes(loyaltyPrograms[toProgramId].programId).length > 0, "Target program does not exist");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, inputProof)), "Invalid encrypted amount");

        euint32 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(amount);

        uint256 conversionRate = loyaltyPrograms[toProgramId].publicConversionRate;
        euint32 convertedAmount = FHE.mul(amount, FHE.euint32(conversionRate));

        loyaltyPrograms[fromProgramId].encryptedBalance = FHE.sub(
            loyaltyPrograms[fromProgramId].encryptedBalance,
            amount
        );
        loyaltyPrograms[toProgramId].encryptedBalance = FHE.add(
            loyaltyPrograms[toProgramId].encryptedBalance,
            convertedAmount
        );

        emit PointsExchanged(fromProgramId, toProgramId, FHE.toUint256(convertedAmount));
    }

    function getProgramDetails(string calldata programId) external view returns (
        string memory,
        uint256,
        address,
        uint32,
        bool
    ) {
        require(bytes(loyaltyPrograms[programId].programId).length > 0, "Program does not exist");
        LoyaltyProgram storage program = loyaltyPrograms[programId];

        return (
            program.programId,
            program.publicConversionRate,
            program.programOwner,
            program.decryptedBalance,
            program.isVerified
        );
    }

    function getAllProgramIds() external view returns (string[] memory) {
        return programIds;
    }

    function getEncryptedBalance(string calldata programId) external view returns (euint32) {
        require(bytes(loyaltyPrograms[programId].programId).length > 0, "Program does not exist");
        return loyaltyPrograms[programId].encryptedBalance;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


